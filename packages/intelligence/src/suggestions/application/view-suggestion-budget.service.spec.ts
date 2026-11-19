import { ViewSuggestionBudgetService } from './view-suggestion-budget.service';

function fixture({
  minuteReserved = true,
  dailyClaimed = true,
  costReserved = true,
} = {}) {
  const prisma = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn().mockResolvedValue(1),
    aiViewSuggestionMinute: { deleteMany: jest.fn() },
    aiViewSuggestionBudget: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    aiEmailDailyCost: { upsert: jest.fn() },
  };
  prisma.$queryRaw
    .mockResolvedValueOnce(minuteReserved ? [{ calls: 1 }] : [])
    .mockResolvedValueOnce(costReserved ? [{ reserved: true }] : []);
  prisma.aiViewSuggestionBudget.updateMany
    .mockResolvedValueOnce({ count: 0 })
    .mockResolvedValueOnce({ count: dailyClaimed ? 1 : 0 })
    .mockResolvedValue({ count: 1 });
  const config = {
    get: jest.fn().mockReturnValue(100),
  };
  const service = new ViewSuggestionBudgetService(
    prisma as never,
    config as never,
  );
  return { service, prisma, config };
}

describe('ViewSuggestionBudgetService', () => {
  it('reserves the minute slot, the daily call and the global cost', async () => {
    const { service, prisma, config } = fixture();

    await expect(service.reserve('user-A')).resolves.toBeInstanceOf(Date);

    expect(config.get).toHaveBeenCalledWith(
      'AI_VIEW_SUGGESTION_DAILY_MODEL_BUDGET',
      { infer: true },
    );
    expect(prisma.aiViewSuggestionBudget.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-A' },
      create: expect.objectContaining({ userId: 'user-A', calls: 0 }),
      update: {},
    });
    expect(prisma.aiEmailDailyCost.upsert).toHaveBeenCalled();
  });

  it('stops before the daily call when the minute quota is exhausted', async () => {
    const { service, prisma } = fixture({ minuteReserved: false });

    await expect(service.reserve('user-A')).resolves.toBeNull();
    expect(prisma.aiViewSuggestionBudget.upsert).not.toHaveBeenCalled();
  });

  it('stops before the model cost when the daily quota is exhausted', async () => {
    const { service, prisma } = fixture({ dailyClaimed: false });

    await expect(service.reserve('user-A')).resolves.toBeNull();
    expect(prisma.aiEmailDailyCost.upsert).not.toHaveBeenCalled();
  });

  it('releases the daily call when the global cost cap is full', async () => {
    const { service, prisma } = fixture({ costReserved: false });

    await expect(service.reserve('user-A')).resolves.toBeNull();
    expect(prisma.aiViewSuggestionBudget.updateMany).toHaveBeenLastCalledWith({
      where: { userId: 'user-A', calls: { gt: 0 } },
      data: { calls: { decrement: 1 } },
    });
  });

  it('settles the reservation with the measured cost', async () => {
    const { service, prisma } = fixture();
    const costDate = new Date('2026-11-19T00:00:00Z');

    await service.settle({ costDate, actualCostUsd: 0.0004 });

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
