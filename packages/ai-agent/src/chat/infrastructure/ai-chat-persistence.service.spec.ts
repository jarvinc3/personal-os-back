jest.mock('@personal-os/database', () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;

      constructor(message: string, options: { code: string }) {
        super(message);
        this.code = options.code;
      }
    },
  },
}));

import { AiChatPersistenceService } from './ai-chat-persistence.service';
import type { AiSessionsRepository } from './ai-sessions.repository';

describe('AiChatPersistenceService', () => {
  const findAssistantByClientMessageId = jest.fn();
  const findUserMessageByClientId = jest.fn();
  const createMessage = jest.fn();
  const touchSession = jest.fn();
  const findSessionByIdOnly = jest.fn();
  const updateSession = jest.fn();
  const findSessionById = jest.fn();

  const sessionsRepo = {
    findAssistantByClientMessageId,
    findUserMessageByClientId,
    createMessage,
    touchSession,
    findSessionByIdOnly,
    updateSession,
    findSessionById,
  } as unknown as jest.Mocked<AiSessionsRepository>;

  const usersRepository = {
    findById: jest.fn(),
  };

  let service: AiChatPersistenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AiChatPersistenceService(
      sessionsRepo,
      usersRepository as never,
    );
  });

  it('returns cached assistant by clientMessageId', async () => {
    findAssistantByClientMessageId.mockResolvedValue({
      id: 'assistant-1',
      content: 'Respuesta final',
      metadata: {
        provider: 'groq',
        model: 'test',
        moduleSlug: 'general',
        moduleLabel: 'General',
      },
    });

    const cached = await service.tryGetCachedResponse('session-1', 'turn-1');

    expect(cached).toEqual({
      sessionId: 'session-1',
      provider: 'groq',
      model: 'test',
      content: 'Respuesta final',
      requiresConfirmation: undefined,
      metadata: {
        provider: 'groq',
        model: 'test',
        moduleSlug: 'general',
        moduleLabel: 'General',
      },
    });
  });

  it('reuses existing user message for the same clientMessageId', async () => {
    const existing = { id: 'user-1' };
    findUserMessageByClientId.mockResolvedValue(existing);

    const result = await service.persistUserMessage(
      'session-1',
      'Hola',
      'turn-1',
    );

    expect(result).toBe(existing);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('persists final assistant with clientMessageId but not tool_request rows', async () => {
    findAssistantByClientMessageId.mockResolvedValue(null);
    createMessage.mockResolvedValue({ id: 'assistant-1' });

    await service.persistAssistantMessage(
      'session-1',
      'Listo',
      { provider: 'groq', model: 'test', phase: 'tool_request' },
      [{ id: 'tc-1', name: 'get_profile', arguments: {} }],
    );

    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'assistant',
        clientMessageId: null,
      }),
    );

    await service.persistAssistantMessage(
      'session-1',
      'Respuesta final',
      { provider: 'groq', model: 'test' },
      null,
      'turn-1',
    );

    expect(createMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: 'assistant',
        clientMessageId: 'turn-1',
        metadata: expect.objectContaining({ clientMessageId: 'turn-1' }),
      }),
    );
  });

  it('reuses existing final assistant for the same clientMessageId', async () => {
    const existing = { id: 'assistant-1', content: 'Respuesta final' };
    findAssistantByClientMessageId.mockResolvedValue(existing);

    const result = await service.persistAssistantMessage(
      'session-1',
      'Respuesta final',
      { provider: 'groq', model: 'test' },
      null,
      'turn-1',
    );

    expect(result).toBe(existing);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('persists the incoming chat context', async () => {
    updateSession.mockResolvedValue({ id: 'session-1' });
    const context = {
      moduleSlug: 'finance',
      screen: 'loan-detail',
      entityRef: { type: 'loan' as const, id: 'loan-1' },
    };

    await service.persistChatContext('session-1', context);

    expect(updateSession).toHaveBeenCalledWith('session-1', {
      chatContext: context,
    });
  });

  it('reads the stored chat context', async () => {
    findSessionById.mockResolvedValue({
      id: 'session-1',
      chatContext: {
        moduleSlug: 'finance',
        entityRef: { type: 'budget', id: 'budget-1' },
      },
    });

    const stored = await service.readChatContext('user-1', 'session-1');

    expect(stored).toEqual({
      moduleSlug: 'finance',
      entityRef: { type: 'budget', id: 'budget-1' },
    });
  });

  it('returns null when the stored chat context is malformed', async () => {
    findSessionById.mockResolvedValue({
      id: 'session-1',
      chatContext: { entityRef: { type: 'loan', id: 'loan-1' } },
    });

    const stored = await service.readChatContext('user-1', 'session-1');

    expect(stored).toBeNull();
  });

  it('rejects reading the chat context of a missing session', async () => {
    findSessionById.mockResolvedValue(null);

    await expect(
      service.readChatContext('user-1', 'session-missing'),
    ).rejects.toThrow('Sesión de IA no encontrada');
  });
});
