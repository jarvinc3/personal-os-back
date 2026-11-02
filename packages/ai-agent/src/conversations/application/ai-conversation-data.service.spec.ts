import { AiConversationDataService } from './ai-conversation-data.service';

describe('AiConversationDataService', () => {
  it('counts and wipes only conversations owned by the requested user', async () => {
    const prisma = {
      aiConversation: {
        count: jest.fn().mockResolvedValue(2),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const service = new AiConversationDataService(prisma as never);

    await expect(service.countForUser('user-1')).resolves.toBe(2);
    await expect(service.wipeForUser('user-1')).resolves.toBe(2);
    expect(prisma.aiConversation.count).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(prisma.aiConversation.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });
});
