import { NotFoundException } from '@nestjs/common';
import { AiConversationStore } from './ai-conversation.store';
import { aiInvocationContextKey } from './ai-invocation-context-key';

describe('AiConversationStore', () => {
  it('returns the latest conversation only for the requested owner and context key', async () => {
    const conversation = {
      id: 'latest-1',
      title: 'Latest',
      summary: null,
      summaryUpdatedAt: null,
      invocationContext: { route: '/finance' },
      createdAt: new Date('2026-11-01T00:00:00Z'),
      updatedAt: new Date('2026-11-02T00:00:00Z'),
      messages: [],
    };
    const prisma = {
      aiConversation: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'latest-1' })
          .mockResolvedValueOnce(conversation),
      },
    };
    const store = new AiConversationStore(prisma);

    await expect(
      store.findLatestByContext('user-A', 'a'.repeat(64)),
    ).resolves.toMatchObject({ id: 'latest-1' });
    expect(prisma.aiConversation.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { userId: 'user-A', contextKey: 'a'.repeat(64) },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      }),
    );
    expect(prisma.aiConversation.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { id: 'latest-1', userId: 'user-A' } }),
    );
  });

  it('returns null when the user has no conversation for the requested context', async () => {
    const prisma = {
      aiConversation: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const store = new AiConversationStore(prisma);

    await expect(
      store.findLatestByContext('user-A', 'b'.repeat(64)),
    ).resolves.toBeNull();
    expect(prisma.aiConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-A', contextKey: 'b'.repeat(64) },
      }),
    );
  });

  it('backfills keys for existing contextual conversations in bounded batches', async () => {
    const context = { route: '/finance', view: 'transactions' };
    const contextKey = aiInvocationContextKey(context);
    const storedUpdatedAt = new Date('2026-11-02T00:00:00Z');
    const conversation = {
      id: 'legacy-1',
      title: 'Legacy',
      summary: null,
      summaryUpdatedAt: null,
      invocationContext: context,
      createdAt: new Date('2026-11-01T00:00:00Z'),
      updatedAt: storedUpdatedAt,
      messages: [],
    };
    const prisma = {
      aiConversation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'legacy-1',
            updatedAt: storedUpdatedAt,
            invocationContext: context,
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'legacy-1' })
          .mockResolvedValueOnce(conversation),
      },
    };
    const store = new AiConversationStore(prisma);

    await expect(
      store.findLatestByContext('user-A', contextKey),
    ).resolves.toMatchObject({ id: 'legacy-1' });
    expect(prisma.aiConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
    expect(prisma.aiConversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'legacy-1', userId: 'user-A', contextKey: null },
      data: {
        contextKey: contextKey,
        updatedAt: storedUpdatedAt,
      },
    });
  });

  it('ignores stored contexts that are not invocable contexts', async () => {
    const prisma = {
      aiConversation: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'broken-1', updatedAt: new Date(), invocationContext: null },
          { id: 'broken-2', updatedAt: new Date(), invocationContext: {} },
        ]),
        updateMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const store = new AiConversationStore(prisma);

    await expect(
      store.findLatestByContext('user-A', 'c'.repeat(64)),
    ).resolves.toBeNull();
    expect(prisma.aiConversation.updateMany).not.toHaveBeenCalled();
  });

  it('queries by authenticated owner and orders history by sequence', async () => {
    const prisma = {
      aiConversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'conversation-1',
          title: 'Gastos',
          summary: null,
          summaryUpdatedAt: null,
          createdAt: new Date('2026-11-01T00:00:00Z'),
          updatedAt: new Date('2026-11-01T00:00:00Z'),
          messages: [
            {
              role: 'USER',
              content: '¿Cuánto gasté?',
              name: null,
              toolCallId: null,
              toolCalls: null,
              createdAt: new Date('2026-11-01T00:01:00Z'),
            },
          ],
        }),
      },
    };
    const store = new AiConversationStore(prisma);

    await expect(
      store.findOwned('user-A', 'conversation-1'),
    ).resolves.toMatchObject({
      messages: [{ role: 'user', content: '¿Cuánto gasté?' }],
    });
    expect(prisma.aiConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conversation-1', userId: 'user-A' },
        select: expect.objectContaining({
          messages: expect.objectContaining({
            orderBy: { sequence: 'asc' },
          }),
        }),
      }),
    );
  });

  it('does not reveal whether a conversation belongs to another user', async () => {
    const prisma = {
      aiConversation: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const store = new AiConversationStore(prisma);

    await expect(
      store.findOwned('user-B', 'conversation-owned-by-A'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.aiConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conversation-owned-by-A', userId: 'user-B' },
      }),
    );
  });

  it('finds the user and assistant of a turn by client message id', async () => {
    const createdAt = new Date('2026-11-19T10:00:00Z');
    const prisma = {
      aiConversationMessage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'message-user',
            role: 'USER',
            content: '¿Cuánto gasté?',
            clientMessageId: 'turn-1',
            provider: null,
            model: null,
            createdAt,
          },
          {
            id: 'message-assistant',
            role: 'ASSISTANT',
            content: 'Gastaste RD$1,250.',
            clientMessageId: 'turn-1',
            provider: 'Groq',
            model: 'model-1',
            createdAt,
          },
        ]),
      },
    };
    const store = new AiConversationStore(prisma as never);

    await expect(
      store.findTurn({
        userId: 'user-A',
        conversationId: 'conversation-1',
        clientMessageId: 'turn-1',
      }),
    ).resolves.toMatchObject({
      user: { content: '¿Cuánto gasté?', role: 'user' },
      assistant: {
        content: 'Gastaste RD$1,250.',
        role: 'assistant',
        provider: 'Groq',
      },
    });
    expect(prisma.aiConversationMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-A',
          conversationId: 'conversation-1',
          clientMessageId: 'turn-1',
          role: { in: ['USER', 'ASSISTANT'] },
        },
      }),
    );
  });

  it('saves a full turn and touches the conversation in one transaction', async () => {
    const transaction = {
      aiConversationMessage: { create: jest.fn().mockResolvedValue({}) },
      aiConversation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (value: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };
    const store = new AiConversationStore(prisma as never);

    await store.appendTurn({
      userId: 'user-A',
      conversationId: 'conversation-1',
      messages: [
        {
          message: { role: 'assistant', content: 'Gastaste RD$1,250.' },
          clientMessageId: 'turn-1',
          provider: 'Groq',
          model: 'model-1',
        },
      ],
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.aiConversationMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-A',
        conversationId: 'conversation-1',
        role: 'ASSISTANT',
        content: 'Gastaste RD$1,250.',
        clientMessageId: 'turn-1',
        provider: 'Groq',
        model: 'model-1',
      }),
    });
    expect(transaction.aiConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conversation-1', userId: 'user-A' },
      }),
    );
  });
});
