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
} from '@personal-os/contracts';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@personal-os/database';
import type { AiInvocationContextDto } from '../presentation/dto/ai-conversation.dto';
import { AiContextAssembler } from './ai-context-assembler';
import { AiConversationStore } from './ai-conversation.store';
import {
  AiActionsService,
  type AiActionResult,
} from '../../actions/application/ai-actions.service';

const MAX_TOOL_ROUNDS = 4;
const SUMMARY_AFTER_MESSAGES = 24;
const SUMMARY_RECENT_MESSAGES = 12;

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

  async createConversation(userId: string, context?: AiInvocationContextDto) {
    const resolved = await this.validateInvocationContext(userId, context);
    return this.conversations.create(
      userId,
      resolved as Prisma.InputJsonValue | undefined,
    );
  }

  async sendMessage(
    userId: string,
    conversationId: string,
    content: string,
    context?: AiInvocationContextDto,
  ) {
    const resolvedContext = await this.validateInvocationContext(
      userId,
      context,
    );
    const initial = await this.conversations.findOwned(userId, conversationId);
    if (resolvedContext) {
      await this.conversations.setInvocationContext(
        userId,
        conversationId,
        resolvedContext as Prisma.InputJsonValue,
      );
    }
    const hadUserMessages = initial.messages.some(
      (message) => message.role === 'user',
    );
    await this.conversations.append(userId, conversationId, {
      role: 'user',
      content,
    });
    if (!hadUserMessages) {
      await this.conversations.setTitleFromFirstMessage(
        userId,
        conversationId,
        content,
      );
    }

    const conversation = await this.conversations.findOwned(
      userId,
      conversationId,
    );
    const history = conversation.messages;
    await this.refreshSummary(
      userId,
      conversationId,
      conversation.summary,
      history,
    );
    const latest = await this.conversations.findOwned(userId, conversationId);
    const descriptors = this.availableCapabilities();
    const ctx: AiExecutionContext = {
      userId,
      invocationId: randomUUID(),
      correlationId: conversationId,
    };
    const messages = await this.contextAssembler.assemble({
      ctx,
      descriptors,
      history,
      summary: latest.summary,
      invocationContext: resolvedContext ?? latest.invocationContext,
    });
    const definitions: AiToolSpec[] = descriptors.map((descriptor) => ({
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

    const proposedActions: AiActionResult[] = [];
    let completion = await this.inference.complete(messages, definitions);
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      if (!completion.toolCalls.length) {
        break;
      }

      const assistantToolCall: AiConversationMessage = {
        role: 'assistant',
        content: completion.content,
        toolCalls: completion.toolCalls,
      };
      messages.push(assistantToolCall);
      await this.conversations.append(
        userId,
        conversationId,
        assistantToolCall,
      );

      for (const call of completion.toolCalls) {
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
              `${conversationId}:${ctx.invocationId}:${call.id}`,
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
        const toolMessage: AiConversationMessage = {
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: toolContent,
        };
        messages.push(toolMessage);
        await this.conversations.append(userId, conversationId, toolMessage);
      }
      completion = await this.inference.complete(
        messages,
        round + 1 < MAX_TOOL_ROUNDS ? definitions : undefined,
      );
    }

    const answer =
      completion.content.trim() ||
      'No pude completar una respuesta con los datos disponibles. Inténtalo de nuevo.';
    await this.conversations.append(userId, conversationId, {
      role: 'assistant',
      content: answer,
    });
    return {
      conversationId,
      answer,
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

  private async validateInvocationContext(
    userId: string,
    context?: AiInvocationContextDto,
  ): Promise<Record<string, unknown> | undefined> {
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
    return context as unknown as Record<string, unknown>;
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
