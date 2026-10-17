import { BadRequestException } from '@nestjs/common';
import { encodeCursor } from '@personal-os/core';
import type { PrismaService } from '@personal-os/database';
import { AiSessionsRepository } from './ai-sessions.repository';

const CURSOR_DATE = '2026-10-16T10:00:00.000Z';

function createRepository() {
  const prisma = {
    aiAgentSession: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    aiMessage: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    module: { findFirst: jest.fn() },
  };

  return {
    prisma,
    repository: new AiSessionsRepository(prisma as unknown as PrismaService),
  };
}

describe('AiSessionsRepository', () => {
  it('creates a session with the general context by default', async () => {
    const { repository, prisma } = createRepository();

    await repository.createSession('user-1');

    expect(prisma.aiAgentSession.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', contextType: 'general' },
    });
  });

  it('lists user sessions ordered by activity without a cursor', async () => {
    const { repository, prisma } = createRepository();

    await repository.findSessionsByUser('user-1', { limit: 5 });

    expect(prisma.aiAgentSession.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: [{ lastActiveAt: 'desc' }, { id: 'desc' }],
      take: 6,
      include: {
        module: true,
        messages: {
          where: { role: 'user' },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });
  });

  it('seeks the next page from the cursor point', async () => {
    const { repository, prisma } = createRepository();
    const cursor = encodeCursor({ key: CURSOR_DATE, id: 'session-9' });

    await repository.findSessionsByUser('user-1', { cursor, limit: 2 });

    expect(prisma.aiAgentSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { userId: 'user-1' },
            {
              OR: [
                { lastActiveAt: { lt: new Date(CURSOR_DATE) } },
                {
                  lastActiveAt: new Date(CURSOR_DATE),
                  id: { lt: 'session-9' },
                },
              ],
            },
          ],
        },
        take: 3,
      }),
    );
  });

  it('rejects a forged cursor', () => {
    const { repository } = createRepository();
    const forged = encodeCursor({ key: 'not-a-date', id: 'session-9' });

    expect(() =>
      repository.findSessionsByUser('user-1', { cursor: forged, limit: 2 }),
    ).toThrow(BadRequestException);
  });

  it('finds a session of the current user with its module and messages', async () => {
    const { repository, prisma } = createRepository();

    await repository.findSessionById('session-1', 'user-1');

    expect(prisma.aiAgentSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'session-1', userId: 'user-1' },
      include: {
        module: true,
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
  });

  it('reads only the id and memory snapshot of a session', async () => {
    const { repository, prisma } = createRepository();

    await repository.findSessionByIdOnly('session-1');

    expect(prisma.aiAgentSession.findUnique).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      select: { id: true, memorySnapshot: true },
    });
  });

  it('touches the session with the current time', async () => {
    const { repository, prisma } = createRepository();
    const beforeTouch = Date.now();

    await repository.touchSession('session-1');

    const updateCall = prisma.aiAgentSession.update.mock.calls[0][0] as {
      where: unknown;
      data: { lastActiveAt: Date };
    };
    expect(updateCall.where).toEqual({ id: 'session-1' });
    expect(updateCall.data.lastActiveAt.getTime()).toBeGreaterThanOrEqual(
      beforeTouch,
    );
  });

  it('deletes only the session owned by the user', async () => {
    const { repository, prisma } = createRepository();

    await repository.deleteSession('session-1', 'user-1');

    expect(prisma.aiAgentSession.deleteMany).toHaveBeenCalledWith({
      where: { id: 'session-1', userId: 'user-1' },
    });
  });

  it('deletes every session of the user', async () => {
    const { repository, prisma } = createRepository();

    await repository.deleteAllForUser('user-1');

    expect(prisma.aiAgentSession.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });

  it('creates a message with empty metadata and no client id by default', async () => {
    const { repository, prisma } = createRepository();

    await repository.createMessage({
      sessionId: 'session-1',
      role: 'user',
      content: 'hola',
    });

    expect(prisma.aiMessage.create).toHaveBeenCalledWith({
      data: {
        sessionId: 'session-1',
        role: 'user',
        content: 'hola',
        clientMessageId: null,
        metadata: {},
        toolCalls: undefined,
      },
    });
  });

  it('creates a message with client id, metadata and tool calls', async () => {
    const { repository, prisma } = createRepository();
    const toolCalls = [{ id: 'call-1', name: 'list_accounts', arguments: {} }];

    await repository.createMessage({
      sessionId: 'session-1',
      role: 'assistant',
      content: '',
      clientMessageId: 'client-1',
      metadata: { phase: 'tool_request' },
      toolCalls,
    });

    expect(prisma.aiMessage.create).toHaveBeenCalledWith({
      data: {
        sessionId: 'session-1',
        role: 'assistant',
        content: '',
        clientMessageId: 'client-1',
        metadata: { phase: 'tool_request' },
        toolCalls,
      },
    });
  });

  it('reads the most recent messages with the default limit', async () => {
    const { repository, prisma } = createRepository();

    await repository.findRecentMessages('session-1');

    expect(prisma.aiMessage.findMany).toHaveBeenCalledWith({
      where: { sessionId: 'session-1' },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
  });

  it('matches a user message by stored or metadata client id', async () => {
    const { repository, prisma } = createRepository();

    await repository.findUserMessageByClientId('session-1', 'client-1');

    expect(prisma.aiMessage.findFirst).toHaveBeenCalledWith({
      where: {
        sessionId: 'session-1',
        role: 'user',
        OR: [
          { clientMessageId: 'client-1' },
          {
            metadata: { path: ['clientMessageId'], equals: 'client-1' },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('excludes the tool request phase from assistant lookups', async () => {
    const { repository, prisma } = createRepository();

    await repository.findAssistantByClientMessageId('session-1', 'client-1');

    expect(prisma.aiMessage.findFirst).toHaveBeenCalledWith({
      where: {
        sessionId: 'session-1',
        role: 'assistant',
        OR: [
          { clientMessageId: 'client-1' },
          {
            metadata: { path: ['clientMessageId'], equals: 'client-1' },
          },
        ],
        NOT: {
          metadata: { path: ['phase'], equals: 'tool_request' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns null when the referenced user message does not exist', async () => {
    const { repository, prisma } = createRepository();
    prisma.aiMessage.findUnique.mockResolvedValue(null);

    await expect(
      repository.findAssistantAfterUserMessage('session-1', 'missing'),
    ).resolves.toBeNull();
    expect(prisma.aiMessage.findFirst).not.toHaveBeenCalled();
  });

  it('finds the first assistant message after the user message', async () => {
    const { repository, prisma } = createRepository();
    const createdAt = new Date('2026-10-16T10:00:00.000Z');
    prisma.aiMessage.findUnique.mockResolvedValue({ id: 'msg-1', createdAt });

    await repository.findAssistantAfterUserMessage('session-1', 'msg-1');

    expect(prisma.aiMessage.findFirst).toHaveBeenCalledWith({
      where: {
        sessionId: 'session-1',
        role: 'assistant',
        createdAt: { gt: createdAt },
      },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('updates the session with the given data', async () => {
    const { repository, prisma } = createRepository();
    const sessionUpdate = { contextType: 'finance', moduleId: 'mod-1' };

    await repository.updateSession('session-1', sessionUpdate);

    expect(prisma.aiAgentSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: sessionUpdate,
    });
  });

  it('creates a module session without chat context when none is given', async () => {
    const { repository, prisma } = createRepository();

    await repository.createSessionWithModule('user-1', 'finance');

    expect(prisma.aiAgentSession.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        contextType: 'finance',
        moduleId: null,
      },
    });
  });

  it('creates a module session with chat context', async () => {
    const { repository, prisma } = createRepository();
    const chatContext = { moduleSlug: 'finance' };

    await repository.createSessionWithModule(
      'user-1',
      'finance',
      'mod-1',
      chatContext,
    );

    expect(prisma.aiAgentSession.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        contextType: 'finance',
        moduleId: 'mod-1',
        chatContext,
      },
    });
  });

  it('finds the latest insight session', async () => {
    const { repository, prisma } = createRepository();

    await repository.findLatestInsightSession('user-1');

    expect(prisma.aiAgentSession.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', contextType: 'insight' },
      orderBy: { lastActiveAt: 'desc' },
    });
  });

  it('counts insight messages since a date', async () => {
    const { repository, prisma } = createRepository();
    const since = new Date('2026-10-01T00:00:00.000Z');

    await repository.countInsightMessagesSince('user-1', since);

    expect(prisma.aiMessage.count).toHaveBeenCalledWith({
      where: {
        role: 'assistant',
        createdAt: { gte: since },
        session: { userId: 'user-1', contextType: 'insight' },
        metadata: { path: ['source'], equals: 'insight' },
      },
    });
  });

  it('finds a module by slug', async () => {
    const { repository, prisma } = createRepository();

    await repository.findModuleBySlug('finance');

    expect(prisma.module.findFirst).toHaveBeenCalledWith({
      where: { slug: 'finance' },
    });
  });
});
