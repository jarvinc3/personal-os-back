import { Inject, Injectable } from '@nestjs/common';
import {
  AI_CAPABILITY_REGISTRY,
  type AiCapabilityDescriptor,
  type AiCapabilityRegistryPort,
  type InferenceMessage,
  type JsonObject,
} from '@personal-os/contracts';
import { AiInferenceGateway } from '../inference/application/ai-inference.gateway';
import { inferenceCostUsd } from '../inference/inference-pricing';

export type GeneratedProactiveAction = {
  actionType: string;
  arguments: JsonObject;
};

export type GeneratedProactiveSuggestion = {
  title: string;
  body: string;
  action?: GeneratedProactiveAction;
  costUsd: number;
};

export type ProactiveReasoningInput = {
  userId: string;
  signalId: string;
  signalType: string;
  reviewReason: string;
};

const TASK = 'PROACTIVE_SUGGESTION';
const PROMPT_VERSION = 'proactive-v1';
const SCHEMA_VERSION = '1';
const MAX_TITLE_CHARS = 80;
const MAX_BODY_CHARS = 280;
const MAX_ACTIONS_IN_PROMPT = 5;
const MAX_ACTIONS_PROMPT_CHARS = 4_000;

const SYSTEM_PROMPT = [
  'Sos el asistente de Personal OS. Un evento del usuario quedó esperando una decisión y tenés que ofrecer una ayuda breve.',
  'Escribí un título de máximo 80 caracteres y un cuerpo de máximo 280, en español, sin emojis.',
  'No inventes datos: no conocés el monto, el comercio, fechas ni identificadores del evento.',
  'Si no podés ayudar con este evento, devolvé el cuerpo vacío.',
  'Solo podés proponer una acción si aparece en la lista de acciones disponibles y podés completar todos sus argumentos con datos ciertos.',
  'Respondé solo con el JSON del esquema.',
].join('\n');

const SUGGESTION_JSON_SCHEMA: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'body', 'action'],
  properties: {
    title: { type: 'string' },
    body: { type: 'string' },
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
};

function requireText(value: unknown, field: string, maxChars: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  const text = value.trim();
  if (text.length > maxChars) {
    throw new Error(`${field} must have at most ${maxChars} characters`);
  }
  return text;
}

function validateSuggestion(value: unknown): {
  title: string;
  body: string;
  action?: GeneratedProactiveAction;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Output must be an object');
  }
  const record = value as Record<string, unknown>;
  const title = requireText(record.title, 'title', MAX_TITLE_CHARS);
  const body = requireText(record.body, 'body', MAX_BODY_CHARS);
  const action = toAction(record.action);
  return { title, body, ...(action ? { action } : {}) };
}

function toAction(value: unknown): GeneratedProactiveAction | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const actionType = record.actionType;
  const rawArguments = record.arguments;
  if (typeof actionType !== 'string' || actionType.trim().length === 0) {
    return undefined;
  }
  if (
    !rawArguments ||
    typeof rawArguments !== 'object' ||
    Array.isArray(rawArguments)
  ) {
    return undefined;
  }
  return {
    actionType: actionType.trim(),
    arguments: rawArguments as JsonObject,
  };
}

/**
 * Pide la sugerencia al gateway. El contexto se limita al tipo de señal y al
 * motivo de revisión: nunca viajan cuerpos de correo ni el payload completo.
 */
@Injectable()
export class ProactiveSuggestionGenerator {
  constructor(
    private readonly inference: AiInferenceGateway,
    @Inject(AI_CAPABILITY_REGISTRY)
    private readonly capabilities: AiCapabilityRegistryPort,
  ) {}

  async generate({
    userId,
    signalId,
    signalType,
    reviewReason,
  }: ProactiveReasoningInput): Promise<GeneratedProactiveSuggestion> {
    const completion = await this.inference.infer({
      task: TASK,
      messages: this.buildMessages({ signalType, reviewReason }),
      jsonSchema: SUGGESTION_JSON_SCHEMA,
      validate: validateSuggestion,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      userId,
      sourceType: 'AI_PROACTIVE_SIGNAL',
      sourceId: signalId,
    });
    return {
      ...completion.value,
      costUsd: inferenceCostUsd({
        model: completion.model,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
      }),
    };
  }

  private buildMessages({
    signalType,
    reviewReason,
  }: {
    signalType: string;
    reviewReason: string;
  }): InferenceMessage[] {
    const actions = this.describeActionCapabilities();
    const actionBlock = actions.length
      ? `\n\nAcciones disponibles (JSON):\n${JSON.stringify(actions)}`
      : '\n\nNo hay acciones disponibles: devolvé siempre action en null.';
    return [
      { role: 'system', content: `${SYSTEM_PROMPT}${actionBlock}` },
      {
        role: 'user',
        content: `Evento (JSON):\n${JSON.stringify({ signalType, reviewReason })}`,
      },
    ];
  }

  /**
   * Solo se ofrecen capacidades de escritura con confirmación, así una
   * sugerencia nunca propone un cambio que no pase por la política AI-10.
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
