import { Inject, Injectable } from '@nestjs/common';
import {
  AI_CAPABILITY_REGISTRY,
  type AiCapabilityDescriptor,
  type AiCapabilityRegistryPort,
  type InferenceMessage,
  type JsonObject,
} from '@personal-os/contracts';
import { AiInferenceGateway } from '../../inference/application/ai-inference.gateway';
import { inferenceCostUsd } from '../../inference/inference-pricing';
import {
  MAX_ACTIONS_PROMPT_CHARS,
  MAX_SUGGESTION_LABEL_CHARS,
  MAX_SUGGESTION_PROMPT_CHARS,
  MAX_VIEW_SUGGESTIONS,
} from './view-suggestion-limits';

export type GeneratedSuggestionAction = {
  actionType: string;
  arguments: JsonObject;
};

export type GeneratedSuggestion = {
  label: string;
  prompt: string;
  action?: GeneratedSuggestionAction;
};

export type GeneratedSuggestions = {
  suggestions: GeneratedSuggestion[];
  costUsd: number;
};

const TASK = 'VIEW_SUGGESTIONS';
const PROMPT_VERSION = 'view-suggestions-v1';
const SCHEMA_VERSION = '1';
const MAX_ACTION_ARGUMENT_CHARS = 120;
const MAX_ACTIONS_IN_PROMPT = 5;

const SYSTEM_PROMPT = [
  'Sos el asistente de Personal OS. Proponés entre una y tres sugerencias cortas para la vista actual del usuario.',
  'Cada sugerencia tiene una etiqueta para el badge, de máximo 80 caracteres y sin emojis, y un prompt que el usuario enviará al chat.',
  'Usá la ruta y la vista o sheet para elegir un tema concreto; evitá consejos genéricos.',
  'Solo podés proponer una acción si aparece en la lista de acciones disponibles y podés completar todos sus argumentos con datos ciertos del contexto.',
  'Nunca inventes identificadores, montos, fechas ni nombres. Si no podés completar la acción, omitila.',
  'Respondé solo con el JSON del esquema.',
].join('\n');

const SUGGESTIONS_JSON_SCHEMA: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_VIEW_SUGGESTIONS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'prompt'],
        properties: {
          label: { type: 'string' },
          prompt: { type: 'string' },
          action: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['actionType', 'arguments'],
            properties: {
              actionType: { type: 'string' },
              arguments: { type: 'object' },
            },
          },
        },
      },
    },
  },
};

function requireText(value: unknown, field: string, maxChars: number): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} must not be empty`);
  }
  if (trimmed.length > maxChars) {
    throw new Error(`${field} exceeds ${maxChars} characters`);
  }
  return trimmed;
}

function toAction(value: unknown): GeneratedSuggestionAction | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('action must be an object');
  }
  const record = value as Record<string, unknown>;
  const actionType = requireText(
    record.actionType,
    'action.actionType',
    MAX_ACTION_ARGUMENT_CHARS,
  );
  const actionArguments = record.arguments;
  if (
    !actionArguments ||
    typeof actionArguments !== 'object' ||
    Array.isArray(actionArguments)
  ) {
    throw new Error('action.arguments must be an object');
  }
  return {
    actionType,
    arguments: actionArguments as unknown as JsonObject,
  };
}

/** Validador del gateway: una salida inválida se reintenta y, si persiste, se descarta. */
function validateSuggestions(value: unknown): GeneratedSuggestion[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Output must be an object');
  }
  const rawSuggestions = (value as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(rawSuggestions) || rawSuggestions.length === 0) {
    throw new Error('suggestions must be a non-empty array');
  }
  return rawSuggestions
    .slice(0, MAX_VIEW_SUGGESTIONS)
    .map((rawSuggestion, index) => {
      if (
        !rawSuggestion ||
        typeof rawSuggestion !== 'object' ||
        Array.isArray(rawSuggestion)
      ) {
        throw new Error(`suggestions.${index} must be an object`);
      }
      const record = rawSuggestion as Record<string, unknown>;
      const action = toAction(record.action);
      return {
        label: requireText(
          record.label,
          `suggestions.${index}.label`,
          MAX_SUGGESTION_LABEL_CHARS,
        ),
        prompt: requireText(
          record.prompt,
          `suggestions.${index}.prompt`,
          MAX_SUGGESTION_PROMPT_CHARS,
        ),
        ...(action ? { action } : {}),
      };
    });
}

@Injectable()
export class ViewSuggestionGenerator {
  constructor(
    private readonly inference: AiInferenceGateway,
    @Inject(AI_CAPABILITY_REGISTRY)
    private readonly capabilities: AiCapabilityRegistryPort,
  ) {}

  async generate({
    userId,
    route,
    viewKey,
  }: {
    userId: string;
    route: string;
    viewKey: string;
  }): Promise<GeneratedSuggestions> {
    const completion = await this.inference.infer({
      task: TASK,
      messages: this.buildMessages({ route, viewKey }),
      jsonSchema: SUGGESTIONS_JSON_SCHEMA,
      validate: validateSuggestions,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      userId,
      sourceType: 'AI_VIEW_SUGGESTION',
      sourceId: viewKey || route,
    });
    return {
      suggestions: completion.value,
      costUsd: inferenceCostUsd({
        model: completion.model,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
      }),
    };
  }

  private buildMessages({
    route,
    viewKey,
  }: {
    route: string;
    viewKey: string;
  }): InferenceMessage[] {
    const actions = this.describeActionCapabilities();
    const actionBlock = actions.length
      ? `\n\nAcciones disponibles (JSON):\n${JSON.stringify(actions)}`
      : '\n\nNo hay acciones disponibles: omití siempre el campo action.';
    return [
      { role: 'system', content: `${SYSTEM_PROMPT}${actionBlock}` },
      {
        role: 'user',
        content: `Contexto de la vista (JSON):\n${JSON.stringify({ route, view: viewKey || null })}`,
      },
    ];
  }

  /**
   * Solo se ofrecen capacidades de escritura con confirmación: AI-10 nunca deja
   * que una sugerencia aplique un cambio sola.
   */
  private describeActionCapabilities(): Array<{
    id: string;
    moduleSlug: string;
    description: string;
    inputSchema: JsonObject;
  }> {
    const actions = this.capabilities
      .discover()
      .filter(
        (capability: AiCapabilityDescriptor) =>
          capability.effect === 'WRITE' &&
          capability.actionPolicy === 'CONFIRM_REQUIRED',
      )
      .slice(0, MAX_ACTIONS_IN_PROMPT)
      .map((capability) => ({
        id: capability.id,
        moduleSlug: capability.moduleSlug,
        description: capability.description,
        inputSchema: capability.inputSchema,
      }));
    if (JSON.stringify(actions).length > MAX_ACTIONS_PROMPT_CHARS) {
      return [];
    }
    return actions;
  }
}
