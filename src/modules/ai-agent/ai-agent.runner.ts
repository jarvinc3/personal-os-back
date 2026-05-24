import { Injectable, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueNames } from '../../core/queues/queue.constants';
import { AiProcessingJob } from '../../core/queues/queue-jobs';
import { AiChatPersistenceService } from './ai-chat-persistence.service';
import { AiActionsService } from './ai-actions.service';
import { ToolExecutorService } from './tools/tool-executor.service';
import { getToolDefinition, getToolsForModule } from './tools/tool.registry';
import { AiSessionsRepository } from './ai-sessions.repository';
import type {
  AgentRunResult,
  AiActionSummary,
  ChatBlock,
  SideEffectDescriptor,
} from './utils/ai.types';
import { AiService } from './ai.service';

const MAX_TOOL_ITERATIONS = 5;

@Injectable()
export class AiAgentRunner {
  constructor(
    private readonly aiService: AiService,
    private readonly persistence: AiChatPersistenceService,
    private readonly actionsService: AiActionsService,
    private readonly toolExecutor: ToolExecutorService,
    private readonly sessionsRepo: AiSessionsRepository,
    @Optional()
    @InjectQueue(QueueNames.AI_PROCESSING)
    private readonly aiProcessingQueue?: Queue<AiProcessingJob>,
  ) {}

  async run(input: {
    userId: string;
    sessionId: string;
    userContent: string;
    clientMessageId?: string;
  }): Promise<AgentRunResult> {
    const cached = await this.persistence.tryGetCachedResponse(
      input.sessionId,
      input.clientMessageId,
    );
    if (cached) {
      return {
        sessionId: cached.sessionId,
        provider: cached.provider,
        model: cached.model,
        content: cached.content,
        requiresConfirmation: cached.requiresConfirmation,
      };
    }

    await this.persistence.persistUserMessage(
      input.sessionId,
      input.userContent,
      input.clientMessageId,
    );

    const { messages, prefs, requiresConfirmation, moduleSlug } =
      await this.persistence.buildMessagesForProvider(
        input.userId,
        input.sessionId,
        input.userContent,
      );

    const tools = getToolsForModule(moduleSlug);
    const toolCtx = {
      userId: input.userId,
      sessionId: input.sessionId,
      moduleSlug,
      confirmBeforeActions: prefs.ai.confirmBeforeActions,
    };

    let conversation = [...messages];
    const pendingActions: AiActionSummary[] = [];
    const sideEffects: SideEffectDescriptor[] = [];
    let finalContent = '';
    let provider = '';
    let model = '';

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const result = await this.aiService.chatComplete(
        conversation,
        prefs.ai.defaultProvider,
        tools,
      );
      provider = result.provider;
      model = result.model;

      if (result.toolCalls.length === 0) {
        finalContent = result.content;
        break;
      }

      conversation.push({
        role: 'assistant',
        content: result.content ?? '',
      });

      for (const tc of result.toolCalls) {
        const toolDef = getToolDefinition(tc.name);
        if (!toolDef) {
          conversation.push({
            role: 'tool',
            content: JSON.stringify({ error: `Unknown tool: ${tc.name}` }),
            toolCallId: tc.id,
            name: tc.name,
          });
          continue;
        }

        if (toolDef.mutating && prefs.ai.confirmBeforeActions) {
          const action = await this.actionsService.createPendingAction({
            sessionId: input.sessionId,
            actionType: tc.name,
            payload: tc.arguments,
          });
          pendingActions.push(this.actionsService.toSummary(action));
          conversation.push({
            role: 'tool',
            content: JSON.stringify({
              status: 'pending_confirmation',
              actionId: action.id,
              message: 'Action pending user confirmation',
            }),
            toolCallId: tc.id,
            name: tc.name,
          });
          continue;
        }

        const execResult = await this.toolExecutor.execute(
          toolCtx,
          tc.name,
          tc.arguments,
        );
        sideEffects.push(...(execResult.sideEffects ?? []));

        await this.persistence.persistToolMessage(
          input.sessionId,
          JSON.stringify(execResult),
          { tool: tc.name },
        );

        conversation.push({
          role: 'tool',
          content: JSON.stringify(execResult),
          toolCallId: tc.id,
          name: tc.name,
        });
      }

      if (pendingActions.length > 0 && i === MAX_TOOL_ITERATIONS - 1) {
        finalContent =
          result.content ||
          'He preparado acciones pendientes de tu confirmación.';
      }
    }

    if (!finalContent && pendingActions.length > 0) {
      finalContent =
        'He preparado los cambios solicitados. Confírmalos en las tarjetas de acción.';
    }

    const blocks: ChatBlock[] = [
      { type: 'markdown', content: finalContent },
      ...pendingActions.map((action) => ({ type: 'action' as const, action })),
    ];

    await this.persistence.persistAssistantMessage(
      input.sessionId,
      finalContent,
      {
        provider,
        model,
        requiresConfirmation: pendingActions.length > 0 || requiresConfirmation,
        sideEffects,
        actions: pendingActions,
        blocks,
      },
    );

    const messageCount = await this.sessionsRepo.findRecentMessages(
      input.sessionId,
      100,
    );
    if (messageCount.length >= 30) {
      await this.aiProcessingQueue?.add('ai-summarize-session', {
        userId: input.userId,
        actionType: 'session.summarize',
        payload: { sessionId: input.sessionId },
      });
    }

    return {
      sessionId: input.sessionId,
      provider,
      model,
      content: finalContent,
      requiresConfirmation:
        pendingActions.length > 0 ? true : requiresConfirmation,
      actions: pendingActions.length > 0 ? pendingActions : undefined,
      sideEffects: sideEffects.length > 0 ? sideEffects : undefined,
      blocks,
    };
  }
}
