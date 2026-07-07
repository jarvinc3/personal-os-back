import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AiProcessingJob } from '../../core/queues/queue-jobs';
import { QueueNames } from '../../core/queues/queue.constants';
import { AiActionsService } from './ai-actions.service';
import { AiChatPersistenceService } from './ai-chat-persistence.service';
import { AiChatTurnCoordinator } from './ai-chat-turn-coordinator.service';
import { AiSessionsRepository } from './ai-sessions.repository';
import { AiService } from './ai.service';
import { buildAgentPrompt } from './prompts/build-agent-prompt';
import {
  getModuleContextLabel,
  MODULE_CONTEXT_SWITCH_TOOL,
  resolveModuleContextKey,
} from './prompts/module-context';
import { ToolExecutorService } from './tools/tool-executor.service';
import { getActionLabel, getToolDefinition, getToolsForModule } from './tools/tool.registry';
import type {
  AgentRunResult,
  AgentStreamEvent,
  AiActionSummary,
  ChatBlock,
  ChatMessage,
  SideEffectDescriptor,
  ToolExecutionResult,
} from './utils/ai.types';
import { replayStreamChunks } from './utils/replay-stream-chunks';

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

function applyContextSwitch(
  conversation: ChatMessage[],
  execResult: ToolExecutionResult,
  options: {
    locale: string | null;
    prefs: Awaited<
      ReturnType<AiChatPersistenceService['buildMessagesForProvider']>
    >['prefs'];
    memorySnapshot: Record<string, unknown>;
  },
): string | null {
  const slug = execResult.data?.moduleSlug;
  if (typeof slug !== 'string') {
    return null;
  }

  const activeModuleSlug = slug === 'general' ? null : slug;
  if (conversation[0]?.role === 'system') {
    conversation[0] = {
      role: 'system',
      content: buildAgentPrompt({
        tone: options.prefs.ai.tone,
        locale: options.locale,
        confirmBeforeActions: options.prefs.ai.confirmBeforeActions,
        memorySnapshot: options.memorySnapshot,
        moduleSlug: activeModuleSlug,
      }),
    };
  }

  return activeModuleSlug;
}

@Injectable()
export class AiAgentRunner {
  constructor(
    private readonly aiService: AiService,
    private readonly persistence: AiChatPersistenceService,
    private readonly turnCoordinator: AiChatTurnCoordinator,
    private readonly actionsService: AiActionsService,
    private readonly toolExecutor: ToolExecutorService,
    private readonly sessionsRepo: AiSessionsRepository,
    @Optional()
    @InjectQueue(QueueNames.AI_PROCESSING)
    private readonly aiProcessingQueue?: Queue<AiProcessingJob>,
  ) {}

  async run(
    input: {
      userId: string;
      sessionId: string;
      userContent: string;
      clientMessageId?: string;
    },
    onStream?: (event: AgentStreamEvent) => void,
  ): Promise<AgentRunResult> {
    return this.turnCoordinator.run(
      input,
      (stream) => this.executeRun(input, stream),
      onStream,
    );
  }

  private async executeRun(
    input: {
      userId: string;
      sessionId: string;
      userContent: string;
      clientMessageId?: string;
    },
    onStream?: (event: AgentStreamEvent) => void,
  ): Promise<AgentRunResult> {
    const emitStart = (provider: string, model: string) => {
      onStream?.({
        type: 'start',
        sessionId: input.sessionId,
        provider,
        model,
      });
    };

    const cached = await this.persistence.tryGetCachedResponse(
      input.sessionId,
      input.clientMessageId,
    );
    if (cached) {
      const meta = cached.metadata ?? {};
      const moduleSlug =
        typeof meta.moduleSlug === 'string' ? meta.moduleSlug : 'general';
      const moduleLabel =
        typeof meta.moduleLabel === 'string'
          ? meta.moduleLabel
          : getModuleContextLabel(moduleSlug === 'general' ? null : moduleSlug);

      emitStart(cached.provider, cached.model);
      if (onStream && cached.content) {
        await replayStreamChunks(cached.content, (chunk) => {
          onStream({ type: 'chunk', content: chunk });
        }, { delayMs: 8 });
      }

      return {
        sessionId: cached.sessionId,
        provider: cached.provider,
        model: cached.model,
        content: cached.content,
        moduleSlug,
        moduleLabel,
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

    const {
      messages,
      prefs,
      requiresConfirmation,
      moduleSlug: initialModuleSlug,
      memorySnapshot,
      locale,
    } = await this.persistence.buildMessagesForProvider(
      input.userId,
      input.sessionId,
      input.userContent,
    );

    let activeModuleSlug = initialModuleSlug;
    let tools = getToolsForModule(activeModuleSlug);
    const toolCtx = {
      userId: input.userId,
      sessionId: input.sessionId,
      moduleSlug: activeModuleSlug,
      confirmBeforeActions: prefs.ai.confirmBeforeActions,
    };

    const conversation = [...messages];
    const pendingActions: AiActionSummary[] = [];
    const sideEffects: SideEffectDescriptor[] = [];
    let finalContent = '';
    let provider = '';
    let model = '';

    let toolRetryUsed = false;
    let streamStartSent = false;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const result = await this.aiService.chatCompleteStream(
        conversation,
        prefs.ai.defaultProvider,
        tools,
        (delta) => {
          onStream?.({ type: 'chunk', content: delta });
        },
      );
      provider = result.provider;
      model = result.model;

      if (!streamStartSent) {
        emitStart(provider, model);
        streamStartSent = true;
      }

      if (result.toolCalls.length > 0) {
        onStream?.({ type: 'reset' });
      }

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
        result.content?.trim() ?? '',
        { provider, model, phase: 'tool_request' },
        result.toolCalls,
      );

      for (const tc of result.toolCalls) {
        onStream?.({
          type: 'status',
          message: getActionLabel(tc.name, tc.arguments),
        });

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

        if (tc.name === MODULE_CONTEXT_SWITCH_TOOL && execResult.success) {
          activeModuleSlug = applyContextSwitch(conversation, execResult, {
            locale,
            prefs,
            memorySnapshot,
          });
          toolCtx.moduleSlug = activeModuleSlug;
          tools = getToolsForModule(activeModuleSlug);
        }

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
      onStream?.({ type: 'reset' });
      const summary = await this.aiService.chatCompleteStream(
        [
          ...conversation,
          {
            role: 'user',
            content:
              'Resume en una frase breve las acciones pendientes de confirmación para el usuario.',
          },
        ],
        prefs.ai.defaultProvider,
        undefined,
        (delta) => {
          onStream?.({ type: 'chunk', content: delta });
        },
      );
      finalContent =
        summary.content.trim() ||
        'He preparado los cambios solicitados. Confírmalos en las tarjetas de acción.';
      provider = summary.provider;
      model = summary.model;
    }

    const responseModuleSlug = resolveModuleContextKey(activeModuleSlug);
    const responseModuleLabel = getModuleContextLabel(activeModuleSlug);

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
        moduleSlug: responseModuleSlug,
        moduleLabel: responseModuleLabel,
        requiresConfirmation: pendingActions.length > 0 || requiresConfirmation,
        sideEffects,
        actions: pendingActions,
        blocks,
      },
      null,
      input.clientMessageId,
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
      moduleSlug: responseModuleSlug,
      moduleLabel: responseModuleLabel,
      requiresConfirmation:
        pendingActions.length > 0 ? true : requiresConfirmation,
      actions: pendingActions.length > 0 ? pendingActions : undefined,
      sideEffects: sideEffects.length > 0 ? sideEffects : undefined,
      blocks,
    };
  }
}
