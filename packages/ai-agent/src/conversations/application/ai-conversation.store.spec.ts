import { NotFoundException } from '@nestjs/common';
import { AiConversationStore } from './ai-conversation.store';

describe('AiConversationStore', () => {
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
    const store = new AiConversationStore(prisma as never);

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
    const store = new AiConversationStore(prisma as never);

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
