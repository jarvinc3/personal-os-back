import { ViewSuggestionStore } from './view-suggestion.store';

function fixture() {
  const prisma = {
    aiViewSuggestion: {
      findMany: jest.fn().mockResolvedValue([]),
      createManyAndReturn: jest.fn().mockResolvedValue([]),
    },
  };
  return { prisma, store: new ViewSuggestionStore(prisma as never) };
}

describe('ViewSuggestionStore', () => {
  it('inserts a batch and skips a repeated owner view key', async () => {
    const { prisma, store } = fixture();
    const expiresAt = new Date('2026-11-19T00:30:00Z');

    await store.createMany({
      userId: 'user-A',
      route: '/finance',
      viewKey: 'view:budget',
      suggestions: [{ suggestionKey: 'key-1', label: 'Revisá', prompt: 'P' }],
      expiresAt,
    });

    expect(prisma.aiViewSuggestion.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          {
            userId: 'user-A',
            route: '/finance',
            viewKey: 'view:budget',
            suggestionKey: 'key-1',
            label: 'Revisá',
            prompt: 'P',
            expiresAt,
          },
        ],
        skipDuplicates: true,
      }),
    );
  });

  it('bounds the active read and the known key scan', async () => {
    const { prisma, store } = fixture();
    const now = new Date('2026-11-19T00:00:00Z');

    await store.findActive({
      userId: 'user-A',
      route: '/finance',
      viewKey: 'view:budget',
      now,
      limit: 3,
    });
    expect(prisma.aiViewSuggestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-A',
          route: '/finance',
          viewKey: 'view:budget',
          status: 'ACTIVE',
          expiresAt: { gt: now },
        },
        take: 3,
      }),
    );

    await store.findKnownKeys({
      userId: 'user-A',
      route: '/finance',
      viewKey: 'view:budget',
      limit: 1_000,
    });
    expect(prisma.aiViewSuggestion.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orderBy: { suggestionKey: 'asc' },
        take: 1_000,
      }),
    );
  });
});
