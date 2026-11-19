import { ViewSuggestionDataService } from './view-suggestion-data.service';

describe('ViewSuggestionDataService', () => {
  it('counts and wipes the suggestions of the owner', async () => {
    const prisma = {
      aiViewSuggestion: {
        count: jest.fn().mockResolvedValue(3),
        deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
    };
    const service = new ViewSuggestionDataService(prisma as never);

    await expect(service.countForUser('user-A')).resolves.toBe(3);
    await expect(service.wipeForUser('user-A')).resolves.toBe(3);
    expect(prisma.aiViewSuggestion.count).toHaveBeenCalledWith({
      where: { userId: 'user-A' },
    });
    expect(prisma.aiViewSuggestion.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-A' },
    });
  });
});
