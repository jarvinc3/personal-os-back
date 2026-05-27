import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AiProcessingJob } from '../../core/queues/queue-jobs';
import { QueueNames } from '../../core/queues/queue.constants';
import { AiActionsService } from './ai-actions.service';
import { AiChatPersistenceService } from './ai-chat-persistence.service';
import { AiSessionsRepository } from './ai-sessions.repository';
import { AiService } from './ai.service';
import { ToolExecutorService } from './tools/tool-executor.service';
import { getToolDefinition, getToolsForModule } from './tools/tool.registry';
import type {
  AgentRunResult,
  AiActionSummary,
  ChatBlock,
  SideEffectDescriptor,
} from './utils/ai.types';

const MAX_TOOL_ITERATIONS = 5;

function userLikelyNeedsTool(
  userContent: string,
  tools: { mutating: boolean }[],
): boolean {
  if (!tools.some((tool) => tool.mutating)) {
    return false;
  }

  const lower = userContent.toLowerCase();
  return /tema|theme|light|dark|oscuro|claro|notificaci|notification|email|push|activa|desactiva|cambia|change|actualiza|update|preferenc|módulo|module|nombre|name|avatar|foto|perfil|profile|zona horaria|timezone|locale|idioma/.test(
    lower,
  );
}

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
      const meta = cached.metadata ?? {};
      return {
        sessionId: cached.sessionId,
        provider: cached.provider,
        model: cached.model,
        content: cached.content,
        requiresConfirmation: cached.requiresConfirmation,
        actions: meta.actions as AiActionSummary[] | undefined,
        sideEffects: meta.sideEffects as SideEffectDescriptor[] | undefined,
        blocks: meta.blocks as ChatBlock[] | undefined,
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

    const conversation = [...messages];
    const pendingActions: AiActionSummary[] = [];
    const sideEffects: SideEffectDescriptor[] = [];
    let finalContent = '';
    let provider = '';
    let model = '';

    let toolRetryUsed = false;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const result = await this.aiService.chatComplete(
        conversation,
        prefs.ai.defaultProvider,
        tools,
      );
      provider = result.provider;
      model = result.model;

      if (result.toolCalls.length === 0) {
        if (!toolRetryUsed && userLikelyNeedsTool(input.userContent, tools)) {
          toolRetryUsed = true;
          conversation.push({
            role: 'system',
            content: prefs.ai.confirmBeforeActions
              ? 'You MUST call the matching mutating tool via function calling now. Do not ask for confirmation only in text.'
              : 'You MUST call and execute the matching mutating tool immediately via function calling. Do not ask the user to confirm.',
          });
          continue;
        }

        finalContent = result.content;
        break;
      }

      conversation.push({
        role: 'assistant',
        content: result.content ?? '',
        toolCalls: result.toolCalls,
      });

      await this.persistence.persistAssistantMessage(
        input.sessionId,
        result.content ?? '',
        { provider, model, phase: 'tool_request' },
        result.toolCalls,
      );

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
          { tool: tc.name, toolCallId: tc.id },
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

    if (pendingActions.length > 0 && !finalContent.trim()) {
      const summary = await this.aiService.chatComplete(
        [
          ...conversation,
          {
            role: 'user',
            content:
              'Resume en una frase breve las acciones pendientes de confirmación para el usuario.',
          },
        ],
        prefs.ai.defaultProvider,
      );
      finalContent =
        summary.content.trim() ||
        'He preparado los cambios solicitados. Confírmalos en las tarjetas de acción.';
      provider = summary.provider;
      model = summary.model;
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
