import { Prisma } from '@personal-os/database';
import { AnalyticsRepository } from './analytics.repository';

describe('AnalyticsRepository', () => {
  it('excludes transfer legs from cash flow and spending aggregates', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const aggregate = jest.fn().mockResolvedValue({
      _sum: { amountBaseCurrency: null },
    });
    const queryRaw = jest.fn().mockResolvedValue([]);
    const repo = new AnalyticsRepository({
      finTransaction: { groupBy, aggregate },
      $queryRaw: queryRaw,
    } as never);

    await repo.getCashFlowAggregates('user-1');
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          linkedTransactionId: null,
          OR: [{ transferGroupId: null }, { legRole: 'FEE' }],
        }),
      }),
    );

    await repo.getSpendingByCategory('user-1');
    expect(
      groupBy.mock.calls.find(
        ([args]) =>
          (args as { where: { type?: string } }).where.type === 'DEBIT',
      )?.[0],
    ).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          type: 'DEBIT',
          status: 'CONFIRMED',
          linkedTransactionId: null,
          OR: [{ transferGroupId: null }, { legRole: 'FEE' }],
        }),
      }),
    );

    await repo.getSpendingOverTime('user-1', undefined, undefined, 'day');
    const template = queryRaw.mock.calls[0]?.[0];
    const sql = Array.isArray(template) ? template.join(' ') : '';
    expect(sql).toContain('transfer_group_id');
    expect(sql).toContain('leg_role');
    expect(sql).toMatch(/"linked_transaction_id"\s+IS NULL/);
  });

  it('nets the linked refunds from expenses and spending', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValueOnce([
        {
          type: 'DEBIT',
          status: 'CONFIRMED',
          _sum: { amountBaseCurrency: new Prisma.Decimal('100') },
          _count: { _all: 1 },
        },
      ])
      .mockResolvedValueOnce([
        {
          categoryId: 'cat-1',
          _sum: { amountBaseCurrency: new Prisma.Decimal('100') },
        },
      ])
      .mockResolvedValueOnce([
        {
          categoryId: 'cat-1',
          _sum: { amountBaseCurrency: new Prisma.Decimal('40') },
        },
      ]);
    const aggregate = jest.fn().mockResolvedValue({
      _sum: { amountBaseCurrency: new Prisma.Decimal('40') },
    });
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        {
          bucket: new Date('2026-11-01T00:00:00.000Z'),
          type: 'DEBIT',
          total: '100',
        },
      ])
      .mockResolvedValueOnce([
        {
          bucket: new Date('2026-11-01T00:00:00.000Z'),
          total: '40',
        },
      ]);
    const repo = new AnalyticsRepository({
      finTransaction: { groupBy, aggregate },
      $queryRaw: queryRaw,
    } as never);

    const cashFlow = await repo.getCashFlowAggregates('user-1');
    expect(cashFlow[0]?._sum.amountBaseCurrency?.toString()).toBe('60');

    const byCategory = await repo.getSpendingByCategory('user-1');
    expect(byCategory[0]?._sum.amountBaseCurrency?.toString()).toBe('60');

    const overTime = await repo.getSpendingOverTime(
      'user-1',
      undefined,
      undefined,
      'day',
    );
    expect(overTime[0]?.total.toString()).toBe('60');
    expect(overTime[0]?.type).toBe('DEBIT');
  });
});
