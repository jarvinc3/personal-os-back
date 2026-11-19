import { NotFoundException } from '@nestjs/common';
import { AiConversationStore } from './ai-conversation.store';

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
      aiConversation: { findFirst: jest.fn().mockResolvedValue(null) },
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
});
