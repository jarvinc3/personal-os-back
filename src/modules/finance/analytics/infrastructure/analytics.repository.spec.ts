import { AnalyticsRepository } from './analytics.repository';

describe('AnalyticsRepository', () => {
  it('excludes transfer legs from cash flow and spending aggregates', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const queryRaw = jest.fn().mockResolvedValue([]);
    const repo = new AnalyticsRepository({
      finTransaction: { groupBy },
      $queryRaw: queryRaw,
    } as never);

    await repo.getCashFlowAggregates('user-1');
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          transferGroupId: null,
        }),
      }),
    );

    await repo.getSpendingByCategory('user-1');
    expect(groupBy.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          type: 'DEBIT',
          status: 'CONFIRMED',
          transferGroupId: null,
        }),
      }),
    );

    await repo.getSpendingOverTime('user-1', undefined, undefined, 'day');
    const template = queryRaw.mock.calls[0]?.[0];
    const sql = Array.isArray(template) ? template.join(' ') : '';
    expect(sql).toContain('transfer_group_id');
    expect(sql).toContain('IS NULL');
  });
});
