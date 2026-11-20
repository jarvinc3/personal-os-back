import { Inject, Injectable } from '@nestjs/common';
import {
  AI_CONVERSATION_INFERENCE,
  AI_CAPABILITY_REGISTRY,
  AiCapabilityError,
  type AiConversationInferencePort,
  type AiConversationMessage,
  type AiToolSpec,
  type AiCapabilityDescriptor,
  type AiCapabilityRegistryPort,
  type AiExecutionContext,
  type AiToolCall,
} from '@personal-os/contracts';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@personal-os/database';
import type { AiInvocationContext } from '@personal-os/core';
import { aiInvocationContextKey } from './ai-invocation-context-key';
import { AiContextAssembler } from './ai-context-assembler';
import {
  AiConversationStore,
  type StoredTurnMessage,
} from './ai-conversation.store';
import {
  AiActionsService,
  type AiActionResult,
} from '../../actions/application/ai-actions.service';

const MAX_TOOL_ROUNDS = 4;
const SUMMARY_AFTER_MESSAGES = 24;
const SUMMARY_RECENT_MESSAGES = 12;
const EMPTY_ANSWER =
  'No pude completar una respuesta con los datos disponibles. Inténtalo de nuevo.';
const TOOL_STATUS = 'Consultando tus datos…';

type InvocationContextInput = AiInvocationContext;

export type AiConversationActionView = {
  id: string;
  actionType: string;
  targetModule: string;
  policy: string;
  status: string;
  payload: unknown;
  result: unknown;
  outcome: string;
  createdAt: Date;
};

export type AiConversationAnswer = {
  conversationId: string;
  answer: string;
  provider: string;
  model: string;
  actions: AiConversationActionView[];
};

export type AiConversationStreamEvent =
  | { type: 'start'; conversationId: string }
  | { type: 'status'; message: string }
  | { type: 'chunk'; content: string }
  | { type: 'reset' }
  | ({ type: 'done' } & AiConversationAnswer)
  | { type: 'error'; message: string; code?: string };

export type SendMessageInput = {
  userId: string;
  conversationId: string;
  content: string;
  context?: InvocationContextInput;
  clientMessageId?: string;
  onEvent?: (event: AiConversationStreamEvent) => void;
  signal?: AbortSignal;
};

type GenerateTurnInput = {
  userId: string;
  conversationId: string;
  context: unknown;
  descriptors: AiCapabilityDescriptor[];
  definitions: AiToolSpec[];
  history: readonly AiConversationMessage[];
  summary: string | null;
  clientMessageId?: string;
  onEvent?: (event: AiConversationStreamEvent) => void;
  signal?: AbortSignal;
};

type RequestCompletionInput = {
  messages: readonly AiConversationMessage[];
  definitions?: readonly AiToolSpec[];
  onEvent?: (event: AiConversationStreamEvent) => void;
  signal?: AbortSignal;
};

@Injectable()
export class AiOrchestrator {
  constructor(
    private readonly conversations: AiConversationStore,
    private readonly contextAssembler: AiContextAssembler,
    @Inject(AI_CONVERSATION_INFERENCE)
    private readonly inference: AiConversationInferencePort,
    @Inject(AI_CAPABILITY_REGISTRY)
    private readonly capabilities: AiCapabilityRegistryPort,
    private readonly actions: AiActionsService,
  ) {}

  async createConversation(userId: string, context?: InvocationContextInput) {
    const resolved = await this.validateInvocationContext(userId, context);
    return this.conversations.create(
      userId,
      resolved as Prisma.InputJsonValue | undefined,
      resolved ? aiInvocationContextKey(resolved) : undefined,
    );
  }

  async sendMessage({
    userId,
    conversationId,
    content,
    context,
    clientMessageId,
    onEvent,
    signal,
  }: SendMessageInput): Promise<AiConversationAnswer> {
    const initial = await this.conversations.findOwned(userId, conversationId);
    const previousTurn = clientMessageId
      ? await this.conversations.findTurn({
          userId,
          conversationId,
          clientMessageId,
        })
      : { user: null, assistant: null };

    if (previousTurn.user && previousTurn.user.content !== content) {
      throw new ConflictException(
        'El clientMessageId ya se usó con otro contenido',
      );
    }
    if (previousTurn.assistant) {
      return this.replayAnswer({
        conversationId,
        assistant: previousTurn.assistant,
        onEvent,
      });
    }

    const resolvedContext = previousTurn.user
      ? undefined
      : await this.validateInvocationContext(userId, context);
    onEvent?.({ type: 'start', conversationId });
    const hadUserMessages = initial.messages.some(
      (message) => message.role === 'user',
    );
    if (!previousTurn.user) {
      if (resolvedContext) {
        await this.conversations.setInvocationContext(
          userId,
          conversationId,
          resolvedContext as Prisma.InputJsonValue,
          aiInvocationContextKey(resolvedContext),
        );
      }
      await this.conversations.append({
        userId,
        conversationId,
        message: { role: 'user', content },
        clientMessageId,
      });
      if (!hadUserMessages) {
        await this.conversations.setTitleFromFirstMessage(
          userId,
          conversationId,
          content,
        );
      }
    }

    const conversation = await this.conversations.findOwned(
      userId,
      conversationId,
    );
    await this.refreshSummary(
      userId,
      conversationId,
      conversation.summary,
      conversation.messages,
    );
    const latest = await this.conversations.findOwned(userId, conversationId);
    const descriptors = this.availableCapabilities();
    const definitions = this.buildDefinitions(descriptors);
    const answer = await this.generateTurn({
      userId,
      conversationId,
      context: resolvedContext ?? latest.invocationContext,
      descriptors,
      definitions,
      history: latest.messages,
      summary: latest.summary,
      clientMessageId,
      onEvent,
      signal,
    });
    onEvent?.({ type: 'done', ...answer });
    return answer;
  }

  private replayAnswer({
    conversationId,
    assistant,
    onEvent,
  }: {
    conversationId: string;
    assistant: StoredTurnMessage;
    onEvent?: (event: AiConversationStreamEvent) => void;
  }): AiConversationAnswer {
    const answer: AiConversationAnswer = {
      conversationId,
      answer: assistant.content,
      provider: assistant.provider ?? 'saved',
      model: assistant.model ?? 'saved',
      actions: [],
    };
    onEvent?.({ type: 'start', conversationId });
    onEvent?.({ type: 'chunk', content: answer.answer });
    onEvent?.({ type: 'done', ...answer });
    return answer;
  }

  private async generateTurn({
    userId,
    conversationId,
    context,
    descriptors,
    definitions,
    history,
    summary,
    clientMessageId,
    onEvent,
    signal,
  }: GenerateTurnInput): Promise<AiConversationAnswer> {
    const ctx: AiExecutionContext = {
      userId,
      invocationId: randomUUID(),
      correlationId: conversationId,
    };
    const messages = await this.contextAssembler.assemble({
      ctx,
      descriptors,
      history,
      summary,
      invocationContext: context,
    });
    const proposedActions: AiActionResult[] = [];
    const pendingMessages: AiConversationMessage[] = [];
    let completion = await this.requestCompletion({
      messages,
      definitions,
      onEvent,
      signal,
    });

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      if (!completion.toolCalls.length) {
        break;
      }
      onEvent?.({ type: 'status', message: TOOL_STATUS });
      onEvent?.({ type: 'reset' });
      const assistantToolCall: AiConversationMessage = {
        role: 'assistant',
        content: completion.content,
        toolCalls: completion.toolCalls,
      };
      messages.push(assistantToolCall);
      pendingMessages.push(assistantToolCall);

      for (const call of completion.toolCalls) {
        const toolMessage = await this.executeTool({
          ctx,
          descriptors,
          proposedActions,
          call,
        });
        messages.push(toolMessage);
        pendingMessages.push(toolMessage);
      }
      completion = await this.requestCompletion({
        messages,
        definitions: round + 1 < MAX_TOOL_ROUNDS ? definitions : undefined,
        onEvent,
        signal,
      });
    }

    const answerText = completion.content.trim() || EMPTY_ANSWER;
    if (!completion.content.trim()) {
      onEvent?.({ type: 'chunk', content: answerText });
    }
    await this.conversations.appendTurn({
      userId,
      conversationId,
      messages: [
        ...pendingMessages.map((message) => ({ message })),
        {
          message: { role: 'assistant', content: answerText },
          clientMessageId,
          provider: completion.provider,
          model: completion.model,
        },
      ],
    });
    return {
      conversationId,
      answer: answerText,
      provider: completion.provider,
      model: completion.model,
      actions: proposedActions.map(({ outcome, action }) => ({
        id: action.id,
        actionType: action.actionType,
        targetModule: action.targetModule,
        policy: action.policy,
        status: action.status,
        payload: action.payload,
        result: action.result,
        outcome,
        createdAt: action.createdAt,
      })),
    };
  }

  private async executeTool({
    ctx,
    descriptors,
    proposedActions,
    call,
  }: {
    ctx: AiExecutionContext;
    descriptors: readonly AiCapabilityDescriptor[];
    proposedActions: AiActionResult[];
    call: AiToolCall;
  }): Promise<AiConversationMessage> {
    const descriptor = descriptors.find((item) => item.id === call.name);
    let toolContent: string;
    if (!descriptor) {
      toolContent = JSON.stringify({
        ok: false,
        error: 'CAPABILITY_NOT_FOUND',
      });
    } else if (descriptor.effect === 'WRITE') {
      try {
        const action = await this.actions.propose(
          ctx,
          descriptor,
          call.arguments,
          `${ctx.correlationId}:${ctx.invocationId}:${call.id}`,
        );
        proposedActions.push(action);
        toolContent = JSON.stringify({
          ok: !['FORBIDDEN', 'FAILED'].includes(action.outcome),
          outcome: action.outcome,
          action: {
            id: action.action.id,
            policy: action.action.policy,
            status: action.action.status,
          },
          result: action.action.result,
        });
      } catch (error) {
        const code =
          error instanceof AiCapabilityError
            ? error.code
            : 'ACTION_POLICY_FAILED';
        toolContent = JSON.stringify({ ok: false, error: code });
      }
    } else {
      try {
        const result = await this.capabilities.execute(
          ctx,
          descriptor.id,
          call.arguments,
        );
        toolContent = JSON.stringify({ ok: true, data: result });
      } catch (error) {
        const code =
          error instanceof AiCapabilityError
            ? error.code
            : 'CAPABILITY_EXECUTION_FAILED';
        toolContent = JSON.stringify({ ok: false, error: code });
      }
    }
    return {
      role: 'tool',
      toolCallId: call.id,
      name: call.name,
      content: toolContent,
    };
  }

  private async requestCompletion({
    messages,
    definitions,
    onEvent,
    signal,
  }: RequestCompletionInput) {
    if (!onEvent || !this.inference.stream) {
      const completion = await this.inference.complete(messages, definitions);
      if (onEvent && completion.content) {
        onEvent({ type: 'chunk', content: completion.content });
      }
      return completion;
    }
    return this.inference.stream({
      messages,
      tools: definitions,
      signal,
      onContent: (content) => onEvent({ type: 'chunk', content }),
      onReset: () => onEvent({ type: 'reset' }),
    });
  }

  private buildDefinitions(
    descriptors: readonly AiCapabilityDescriptor[],
  ): AiToolSpec[] {
    return descriptors.map((descriptor) => ({
      name: descriptor.id,
      description:
        descriptor.effect === 'WRITE'
          ? `${descriptor.description} Política de acción: ${descriptor.actionPolicy ?? 'FORBIDDEN'}.`
          : descriptor.description,
      parameters: descriptor.inputSchema,
      moduleSlug: descriptor.moduleSlug,
      effect: descriptor.effect,
      ...(descriptor.actionPolicy
        ? { actionPolicy: descriptor.actionPolicy }
        : {}),
    }));
  }

  private async validateInvocationContext(
    userId: string,
    context?: InvocationContextInput,
  ): Promise<InvocationContextInput | undefined> {
    if (!context) {
      return undefined;
    }
    if (JSON.stringify(context).length > 6000) {
      throw new BadRequestException('Contexto de invocación demasiado largo');
    }
    if (context.entityRef) {
      if (!this.capabilities.resolveEntity) {
        throw new BadRequestException(
          'No se puede resolver la entidad indicada',
        );
      }
      const entity = await this.capabilities.resolveEntity(
        {
          userId,
          invocationId: randomUUID(),
          correlationId: 'context-validation',
        },
        context.entityRef,
      );
      if (!entity) {
        throw new BadRequestException(
          'La entidad no existe o no pertenece al usuario',
        );
      }
    }
    return context;
  }

  private availableCapabilities(): AiCapabilityDescriptor[] {
    return [...this.capabilities.discover()];
  }

  private async refreshSummary(
    userId: string,
    conversationId: string,
    currentSummary: string | null,
    history: readonly AiConversationMessage[],
  ): Promise<void> {
    if (history.length < SUMMARY_AFTER_MESSAGES || history.length % 10 !== 0) {
      return;
    }
    const messagesToSummarize = history.slice(0, -SUMMARY_RECENT_MESSAGES);
    if (!messagesToSummarize.length) {
      return;
    }
    try {
      const summary = await this.inference.summarize([
        ...(currentSummary
          ? [
              {
                role: 'system' as const,
                content: `Resumen anterior:\n${currentSummary}`,
              },
            ]
          : []),
        ...messagesToSummarize,
      ]);
      if (summary) {
        await this.conversations.saveSummary(userId, conversationId, summary);
      }
    } catch {
      // Summary is an optional private convenience; a failed summary does not block a turn.
    }
  }
}
