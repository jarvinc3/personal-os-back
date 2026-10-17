import type {
  ChatBlock,
  ChatCompletionResult,
  ToolCallRequest,
} from '../../shared/ai.types';
import {
  getActionLabel,
  getToolDefinition,
  getToolsForModule,
} from '../../tools/tool.registry';
import { buildChatBlocks } from '../../shared/build-chat-blocks';
import { AiAgentRunner } from './ai-agent.runner';

jest.mock('../../tools/tool.registry', () => ({
  getToolsForModule: jest.fn(),
  getToolDefinition: jest.fn(),
  getActionLabel: jest.fn(),
}));

jest.mock('../../shared/build-chat-blocks', () => ({
  buildChatBlocks: jest.fn(() => []),
}));

const mockedGetToolsForModule = jest.mocked(getToolsForModule);
const mockedGetToolDefinition = jest.mocked(getToolDefinition);
const mockedGetActionLabel = jest.mocked(getActionLabel);
const mockedBuildChatBlocks = jest.mocked(buildChatBlocks);

const listTool = {
  name: 'list_transactions',
  description: 'Lista movimientos',
  parameters: {},
  mutating: false,
  targetModule: 'finance',
};

const mutatingTool = {
  name: 'update_user_preferences',
  description: 'Cambia preferencias',
  parameters: {},
  mutating: true,
  targetModule: 'settings',
};

const switchModuleTool = {
  name: 'switch_module_context',
  description: 'Cambia el módulo activo',
  parameters: {},
  mutating: false,
  targetModule: 'general',
};

const SYSTEM_MESSAGE = { role: 'system' as const, content: 'prompt base' };

type AgentRunInput = Parameters<AiAgentRunner['run']>[0];

function providerHistory(overrides: Record<string, unknown> = {}) {
  return {
    messages: [SYSTEM_MESSAGE, { role: 'user' as const, content: 'hola' }],
    prefs: {
      ai: {
        tone: 'balanced' as const,
        defaultProvider: 'groq',
        confirmBeforeActions: false,
      },
    },
    requiresConfirmation: false,
    memorySnapshot: {},
    moduleSlug: null,
    locale: 'es',
    ...overrides,
  };
}

function completion(
  content: string,
  toolCalls: ToolCallRequest[] = [],
): ChatCompletionResult & { provider: string; model: string } {
  return { content, toolCalls, provider: 'groq', model: 'llama' };
}

function toolCall(
  name: string,
  args: Record<string, unknown> = {},
): ToolCallRequest {
  return { id: `call-${name}`, name, arguments: args };
}

function createRunner() {
  const aiService = { chatCompleteStream: jest.fn() };
  const persistence = {
    tryGetCachedResponse: jest.fn().mockResolvedValue(null),
    persistUserMessage: jest.fn().mockResolvedValue({ id: 'msg-user' }),
    readChatContext: jest.fn().mockResolvedValue(null),
    persistChatContext: jest.fn().mockResolvedValue(undefined),
    buildMessagesForProvider: jest.fn().mockResolvedValue(providerHistory()),
    persistAssistantMessage: jest
      .fn()
      .mockResolvedValue({ id: 'msg-assistant' }),
    persistToolMessage: jest.fn().mockResolvedValue({ id: 'msg-tool' }),
  };
  const turnCoordinator = {
    run: jest.fn(
      (
        input: unknown,
        execute: (stream?: unknown) => unknown,
        onStream?: unknown,
      ) => execute(onStream),
    ),
  };
  const actionsService = {
    createPendingAction: jest.fn(),
    toSummary: jest.fn((action: { id: string }) => ({
      id: action.id,
      actionType: 'update_user_preferences',
      targetModule: 'settings',
      payload: {},
      status: 'pending',
    })),
  };
  const toolExecutor = { execute: jest.fn() };
  const sessionsRepo = { findRecentMessages: jest.fn().mockResolvedValue([]) };
  const financeFacade = {
    resolveChatContextEntity: jest.fn().mockResolvedValue(null),
    getBaseCurrency: jest.fn().mockResolvedValue('DOP'),
  };
  const aiProcessingQueue = { add: jest.fn().mockResolvedValue(undefined) };

  return {
    runner: new AiAgentRunner(
      aiService as never,
      persistence as never,
      turnCoordinator as never,
      actionsService as never,
      toolExecutor as never,
      sessionsRepo as never,
      financeFacade as never,
      aiProcessingQueue as never,
    ),
    aiService,
    persistence,
    actionsService,
    toolExecutor,
    sessionsRepo,
    financeFacade,
    aiProcessingQueue,
  };
}

function runInput(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    userContent: 'hola',
    ...overrides,
  };
}

describe('AiAgentRunner', () => {
  beforeEach(() => {
    mockedGetToolsForModule.mockReturnValue([listTool, mutatingTool]);
    mockedGetToolDefinition.mockImplementation((name) =>
      name === listTool.name
        ? listTool
        : name === mutatingTool.name
          ? mutatingTool
          : name === switchModuleTool.name
            ? switchModuleTool
            : undefined,
    );
    mockedGetActionLabel.mockImplementation((name) => `label:${name}`);
    mockedBuildChatBlocks.mockReturnValue([]);
  });

  it('answers a plain turn and persists the assistant message', async () => {
    const { runner, aiService, persistence, financeFacade } = createRunner();
    aiService.chatCompleteStream.mockResolvedValue(completion('respuesta'));

    const agentRun = await runner.run(runInput());

    expect(aiService.chatCompleteStream).toHaveBeenCalledTimes(1);
    expect(persistence.persistUserMessage).toHaveBeenCalledWith(
      'session-1',
      'hola',
      undefined,
    );
    expect(financeFacade.getBaseCurrency).not.toHaveBeenCalled();
    expect(persistence.persistAssistantMessage).toHaveBeenCalledWith(
      'session-1',
      'respuesta',
      expect.objectContaining({
        provider: 'groq',
        model: 'llama',
        moduleSlug: 'general',
        requiresConfirmation: false,
      }),
      null,
      undefined,
    );
    expect(agentRun).toMatchObject({
      sessionId: 'session-1',
      provider: 'groq',
      model: 'llama',
      content: 'respuesta',
      moduleSlug: 'general',
      requiresConfirmation: false,
    });
    expect(agentRun.blocks).toEqual([
      { type: 'markdown', content: 'respuesta' },
    ]);
  });

  it('streams the start and chunk events', async () => {
    const { runner, aiService } = createRunner();
    aiService.chatCompleteStream.mockImplementation(
      (
        _messages: unknown,
        _provider: unknown,
        _tools: unknown,
        onToken: (delta: string) => void,
      ) => {
        onToken('res');
        onToken('puesta');
        return Promise.resolve(completion('respuesta'));
      },
    );
    const events: string[] = [];

    await runner.run(runInput(), (event) => {
      events.push(event.type);
    });

    expect(events).toEqual(['chunk', 'chunk', 'start']);
  });

  it('replays a cached response without rebuilding the provider history', async () => {
    const { runner, persistence } = createRunner();
    persistence.tryGetCachedResponse.mockResolvedValue({
      sessionId: 'session-1',
      provider: 'groq',
      model: 'llama',
      content: 'cacheada',
      requiresConfirmation: true,
      metadata: {
        moduleSlug: 'finance',
        actions: [{ id: 'action-1' }],
        sideEffects: [{ type: 'invalidate', keys: ['transactions'] }],
      },
    });
    const events: string[] = [];

    const agentRun = await runner.run(
      runInput({ clientMessageId: 'client-1' }),
      (event) => {
        events.push(event.type);
      },
    );

    expect(persistence.buildMessagesForProvider).not.toHaveBeenCalled();
    expect(events[0]).toBe('start');
    expect(events).toContain('chunk');
    expect(agentRun).toMatchObject({
      content: 'cacheada',
      moduleSlug: 'finance',
      requiresConfirmation: true,
    });
    expect(agentRun.actions).toEqual([{ id: 'action-1' }]);
  });

  it('does not replay chunks for an empty cached response', async () => {
    const { runner, persistence } = createRunner();
    persistence.tryGetCachedResponse.mockResolvedValue({
      sessionId: 'session-1',
      provider: 'groq',
      model: 'llama',
      content: '',
      metadata: {},
    });
    const events: string[] = [];

    const agentRun = await runner.run(runInput(), (event) => {
      events.push(event.type);
    });

    expect(events).toEqual(['start']);
    expect(agentRun.moduleSlug).toBe('general');
  });

  it('loads the stored chat context and resolves its entity', async () => {
    const { runner, persistence, financeFacade, aiService } = createRunner();
    aiService.chatCompleteStream.mockResolvedValue(completion('ok'));
    persistence.readChatContext.mockResolvedValue({
      moduleSlug: 'finance',
      entityRef: { type: 'transaction', id: 'tx-1' },
    });

    await runner.run(runInput());

    expect(financeFacade.resolveChatContextEntity).toHaveBeenCalledWith(
      'user-1',
      { type: 'transaction', id: 'tx-1' },
    );
    expect(persistence.persistChatContext).not.toHaveBeenCalled();
  });

  it('persists the chat context sent by the client', async () => {
    const { runner, persistence, aiService } = createRunner();
    aiService.chatCompleteStream.mockResolvedValue(completion('ok'));

    await runner.run(runInput({ context: { moduleSlug: 'finance' } }));

    expect(persistence.persistChatContext).toHaveBeenCalledWith('session-1', {
      moduleSlug: 'finance',
    });
  });

  it('executes a tool, collects side effects and appends its blocks', async () => {
    const { runner, aiService, persistence, toolExecutor, financeFacade } =
      createRunner();
    aiService.chatCompleteStream
      .mockResolvedValueOnce(completion('', [toolCall('list_transactions')]))
      .mockResolvedValueOnce(completion('hecho'));
    toolExecutor.execute.mockResolvedValue({
      success: true,
      message: 'ok',
      sideEffects: [{ type: 'invalidate', keys: ['transactions'] }],
    });
    mockedBuildChatBlocks.mockReturnValue([
      { type: 'markdown', content: 'tool-block' },
    ] as ChatBlock[]);

    const agentRun = await runner.run(runInput());

    expect(toolExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', sessionId: 'session-1' }),
      'list_transactions',
      {},
    );
    expect(financeFacade.getBaseCurrency).toHaveBeenCalledWith('user-1');
    expect(persistence.persistAssistantMessage).toHaveBeenCalledWith(
      'session-1',
      '',
      { provider: 'groq', model: 'llama', phase: 'tool_request' },
      [expect.objectContaining({ name: 'list_transactions' })],
    );
    expect(agentRun.sideEffects).toEqual([
      { type: 'invalidate', keys: ['transactions'] },
    ]);
    expect(agentRun.blocks).toEqual([
      { type: 'markdown', content: 'hecho' },
      { type: 'markdown', content: 'tool-block' },
    ]);
  });

  it('feeds an unknown tool back to the model without executing it', async () => {
    const { runner, aiService, persistence, toolExecutor } = createRunner();
    aiService.chatCompleteStream
      .mockResolvedValueOnce(completion('', [toolCall('ghost_tool')]))
      .mockResolvedValueOnce(completion('no existe'));
    mockedGetToolDefinition.mockReturnValue(undefined);

    const agentRun = await runner.run(runInput());

    expect(toolExecutor.execute).not.toHaveBeenCalled();
    expect(persistence.persistToolMessage).not.toHaveBeenCalled();
    expect(persistence.persistAssistantMessage).toHaveBeenCalledWith(
      'session-1',
      '',
      { provider: 'groq', model: 'llama', phase: 'tool_request' },
      [expect.objectContaining({ name: 'ghost_tool' })],
    );
    expect(agentRun.content).toBe('no existe');
  });

  it('stages a mutating action for confirmation instead of executing it', async () => {
    const { runner, aiService, persistence, actionsService, toolExecutor } =
      createRunner();
    persistence.buildMessagesForProvider.mockResolvedValue(
      providerHistory({
        prefs: {
          ai: {
            tone: 'balanced',
            defaultProvider: 'groq',
            confirmBeforeActions: true,
          },
        },
        requiresConfirmation: true,
      }),
    );
    aiService.chatCompleteStream
      .mockResolvedValueOnce(
        completion('', [
          toolCall('update_user_preferences', { theme: 'dark' }),
        ]),
      )
      .mockResolvedValueOnce(completion('listo'));
    actionsService.createPendingAction.mockResolvedValue({ id: 'action-1' });

    const agentRun = await runner.run(runInput());

    expect(toolExecutor.execute).not.toHaveBeenCalled();
    expect(actionsService.createPendingAction).toHaveBeenCalledWith({
      sessionId: 'session-1',
      actionType: 'update_user_preferences',
      payload: { theme: 'dark' },
    });
    expect(agentRun.requiresConfirmation).toBe(true);
    expect(agentRun.actions).toEqual([
      expect.objectContaining({ id: 'action-1', status: 'pending' }),
    ]);
    expect(agentRun.blocks).toEqual([
      { type: 'markdown', content: 'listo' },
      expect.objectContaining({ type: 'action' }),
    ]);
  });

  it('reports a failed staging attempt to the model', async () => {
    const { runner, aiService, persistence, actionsService } = createRunner();
    persistence.buildMessagesForProvider.mockResolvedValue(
      providerHistory({
        prefs: {
          ai: {
            tone: 'balanced',
            defaultProvider: 'groq',
            confirmBeforeActions: true,
          },
        },
      }),
    );
    aiService.chatCompleteStream
      .mockResolvedValueOnce(
        completion('', [toolCall('update_user_preferences')]),
      )
      .mockResolvedValueOnce(completion('no se pudo'));
    actionsService.createPendingAction.mockRejectedValue(new Error('db down'));

    const agentRun = await runner.run(runInput());

    expect(agentRun.content).toBe('no se pudo');
    expect(agentRun.requiresConfirmation).toBe(false);
  });

  it('switches the module context and reloads its tools', async () => {
    const { runner, aiService, persistence, toolExecutor } = createRunner();
    aiService.chatCompleteStream
      .mockResolvedValueOnce(
        completion('', [
          toolCall('switch_module_context', { moduleSlug: 'finance' }),
        ]),
      )
      .mockResolvedValueOnce(completion('en finanzas'));
    toolExecutor.execute.mockResolvedValue({
      success: true,
      message: 'ok',
      data: { moduleSlug: 'finance' },
    });

    const agentRun = await runner.run(runInput());

    expect(mockedGetToolsForModule).toHaveBeenCalledWith('finance');
    expect(agentRun.moduleSlug).toBe('finance');
    expect(agentRun.content).toBe('en finanzas');
    expect(persistence.persistAssistantMessage).toHaveBeenLastCalledWith(
      'session-1',
      'en finanzas',
      expect.objectContaining({ moduleSlug: 'finance' }),
      null,
      undefined,
    );
  });

  it('retries the turn once when the user asks for a mutating tool', async () => {
    const { runner, aiService } = createRunner();
    aiService.chatCompleteStream
      .mockResolvedValueOnce(completion(''))
      .mockResolvedValueOnce(completion('hecho'));

    const agentRun = await runner.run(
      runInput({ userContent: 'cambia el tema a oscuro' }),
    );

    expect(aiService.chatCompleteStream).toHaveBeenCalledTimes(2);
    const retriedConversation = aiService.chatCompleteStream.mock.calls[1][0];
    expect(retriedConversation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('You MUST call and execute'),
        }),
      ]),
    );
    expect(agentRun.content).toBe('hecho');
  });

  it('stops after the maximum tool iterations', async () => {
    const { runner, aiService, toolExecutor } = createRunner();
    aiService.chatCompleteStream.mockResolvedValue(
      completion('', [toolCall('list_transactions')]),
    );
    toolExecutor.execute.mockResolvedValue({ success: true, message: 'ok' });

    const agentRun = await runner.run(runInput());

    expect(aiService.chatCompleteStream).toHaveBeenCalledTimes(5);
    expect(agentRun.content).toBe('');
  });

  it('summarizes pending actions when the model produced no text', async () => {
    const { runner, aiService, persistence, actionsService } = createRunner();
    persistence.buildMessagesForProvider.mockResolvedValue(
      providerHistory({
        prefs: {
          ai: {
            tone: 'balanced',
            defaultProvider: 'groq',
            confirmBeforeActions: true,
          },
        },
      }),
    );
    aiService.chatCompleteStream
      .mockResolvedValueOnce(
        completion('', [toolCall('update_user_preferences')]),
      )
      .mockResolvedValueOnce(completion(''))
      .mockResolvedValueOnce(completion('resumen de acciones'));
    actionsService.createPendingAction.mockResolvedValue({ id: 'action-1' });

    const agentRun = await runner.run(runInput());

    expect(aiService.chatCompleteStream).toHaveBeenCalledTimes(3);
    expect(agentRun.content).toBe('resumen de acciones');
  });

  it('queues a session summary once the conversation grows', async () => {
    const { runner, aiService, sessionsRepo, aiProcessingQueue } =
      createRunner();
    aiService.chatCompleteStream.mockResolvedValue(completion('respuesta'));
    sessionsRepo.findRecentMessages.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => ({ id: `msg-${index}` })),
    );

    await runner.run(runInput());

    expect(aiProcessingQueue.add).toHaveBeenCalledWith('ai-summarize-session', {
      userId: 'user-1',
      actionType: 'session.summarize',
      payload: { sessionId: 'session-1' },
    });
  });
});
