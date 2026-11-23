import type { BalanceSheetService } from '../../balance-sheet/application/balance-sheet.service';
import type { AnalyticsRepository } from '../infrastructure/analytics.repository';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService', () => {
  const grouped = (rows: Array<{ categoryId: string | null; total: number }>) =>
    rows.map((row) => ({
      categoryId: row.categoryId,
      _sum: { amountBaseCurrency: row.total },
    }));

  const createService = (
    repo: Partial<AnalyticsRepository>,
    balanceSheet?: Partial<BalanceSheetService>,
  ) =>
    new AnalyticsService(
      repo as AnalyticsRepository,
      (balanceSheet ?? {}) as BalanceSheetService,
    );

  it('attaches name color and icon for known categories and keeps totals', async () => {
    const getSpendingByCategory = jest.fn().mockResolvedValue(
      grouped([
        { categoryId: 'cat-food', total: 80 },
        { categoryId: 'cat-home', total: 20 },
      ]),
    );
    const findCategoriesByIds = jest.fn().mockResolvedValue([
      { id: 'cat-food', name: 'Comida', color: '#f00', icon: '🍽️' },
      { id: 'cat-home', name: 'Hogar', color: '#0f0', icon: '🏠' },
    ]);

    const result = await createService({
      getSpendingByCategory,
      findCategoriesByIds,
    }).getSpendingByCategory('user-1', '2026-08-01', '2026-08-31');

    expect(findCategoriesByIds).toHaveBeenCalledWith('user-1', [
      'cat-food',
      'cat-home',
    ]);
    expect(result).toEqual([
      {
        categoryId: 'cat-food',
        name: 'Comida',
        color: '#f00',
        icon: '🍽️',
        total: '80',
      },
      {
        categoryId: 'cat-home',
        name: 'Hogar',
        color: '#0f0',
        icon: '🏠',
        total: '20',
      },
    ]);
  });

  it('uses Sin categoría when categoryId is null', async () => {
    const result = await createService({
      getSpendingByCategory: jest
        .fn()
        .mockResolvedValue(grouped([{ categoryId: null, total: 15 }])),
      findCategoriesByIds: jest.fn().mockResolvedValue([]),
    }).getSpendingByCategory('user-1');

    expect(result).toEqual([
      {
        categoryId: null,
        name: 'Sin categoría',
        color: null,
        icon: null,
        total: '15',
      },
    ]);
  });

  it('falls back when the category row is gone and keeps the total', async () => {
    const result = await createService({
      getSpendingByCategory: jest
        .fn()
        .mockResolvedValue(grouped([{ categoryId: 'deleted-cat', total: 42 }])),
      findCategoriesByIds: jest.fn().mockResolvedValue([]),
    }).getSpendingByCategory('user-1');

    expect(result).toEqual([
      {
        categoryId: 'deleted-cat',
        name: 'Categoría no disponible',
        color: null,
        icon: null,
        total: '42',
      },
    ]);
  });

  it('returns an empty list without looking up categories', async () => {
    const findCategoriesByIds = jest.fn().mockResolvedValue([]);
    const result = await createService({
      getSpendingByCategory: jest.fn().mockResolvedValue([]),
      findCategoriesByIds,
    }).getSpendingByCategory('user-1');

    expect(findCategoriesByIds).toHaveBeenCalledWith('user-1', []);
    expect(result).toEqual([]);
  });

  it('exposes category color and icon in budget status', async () => {
    const result = await createService({
      listBudgets: jest.fn().mockResolvedValue([
        {
          id: 'budget-1',
          categoryId: 'cat-food',
          category: {
            name: 'Comida',
            color: '#f00',
            icon: '🍽️',
          },
          periodType: 'MONTHLY',
          periodStart: new Date('2026-09-01'),
          periodEnd: new Date('2026-09-30'),
          amountLimit: 100,
          amountSpent: 25,
          alertThresholdPct: 80,
        },
      ]),
      sumBudgetSpent: jest.fn().mockResolvedValue(25),
    }).getBudgetStatus('user-1');

    expect(result[0]).toMatchObject({
      category: 'Comida',
      color: '#f00',
      icon: '🍽️',
    });
  });

  it('reads the spent amount from the movements instead of the stored counter', async () => {
    const sumBudgetSpent = jest.fn().mockResolvedValue(60);
    const result = await createService({
      listBudgets: jest.fn().mockResolvedValue([
        {
          id: 'budget-1',
          categoryId: 'cat-food',
          categories: [],
          includeChildren: false,
          name: 'Comida',
          category: { name: 'Comida', color: null, icon: null },
          periodType: 'MONTHLY',
          periodStart: new Date('2026-09-01'),
          periodEnd: new Date('2026-09-30'),
          amountLimit: 100,
          amountSpent: 25,
          alertThresholdPct: 80,
        },
      ]),
      sumBudgetSpent,
    }).getBudgetStatus('user-1');

    expect(sumBudgetSpent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        categoryIds: ['cat-food'],
        includeChildren: false,
      }),
    );
    expect(result[0]).toMatchObject({ amountSpent: '60', pctUsed: 60 });
  });

  it('adds decimal amounts without the float error of 0.1 + 0.2', async () => {
    const getCashFlowAggregates = jest.fn().mockResolvedValue([
      {
        type: 'CREDIT',
        status: 'CONFIRMED',
        _sum: { amountBaseCurrency: '0.1' },
      },
      {
        type: 'CREDIT',
        status: 'CONFIRMED',
        _sum: { amountBaseCurrency: '0.2' },
      },
    ]);
    const getBalanceSheet = jest.fn().mockResolvedValue({
      baseCurrency: 'DOP',
      global: {
        status: 'COMPLETE',
        assets: { accounts: '0' },
        liabilities: { creditCards: '0', loans: '0' },
        netWorth: '0',
        issues: [],
      },
    });

    const summary = await createService(
      { getCashFlowAggregates },
      { getBalanceSheet },
    ).getAnalyticsSummary('user-1');

    expect(summary.totals.income).toBe('0.3');
    expect(summary.cashFlow).toBe('0.3');
  });

  it('sums spending over time as decimals', async () => {
    const getSpendingOverTime = jest.fn().mockResolvedValue([
      {
        bucket: new Date('2026-08-01T00:00:00Z'),
        type: 'DEBIT',
        total: '0.1',
      },
      {
        bucket: new Date('2026-08-01T00:00:00Z'),
        type: 'DEBIT',
        total: '0.2',
      },
    ]);

    const series = await createService({
      getSpendingOverTime,
    }).getSpendingOverTime({
      userId: 'user-1',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      granularity: 'day',
    });

    expect(series.points).toEqual([
      { date: '2026-08-01', expenses: '0.3', income: '0' },
    ]);
  });

  it('delegates net worth to the balance sheet and keeps cash flow in range', async () => {
    const getCashFlowAggregates = jest.fn().mockResolvedValue([
      {
        type: 'CREDIT',
        status: 'CONFIRMED',
        _sum: { amountBaseCurrency: 80 },
      },
      {
        type: 'DEBIT',
        status: 'CONFIRMED',
        _sum: { amountBaseCurrency: 30 },
      },
    ]);
    const getBalanceSheet = jest.fn().mockResolvedValue({
      baseCurrency: 'DOP',
      global: {
        status: 'COMPLETE',
        assets: { accounts: '150000' },
        liabilities: { creditCards: '6000', loans: '13500' },
        netWorth: '130500',
        issues: [],
      },
    });

    const result = await createService(
      { getCashFlowAggregates },
      { getBalanceSheet },
    ).getAnalyticsSummary('user-1', '2026-09-01', '2026-09-11');

    expect(getCashFlowAggregates).toHaveBeenCalledWith(
      'user-1',
      new Date('2026-09-01'),
      new Date('2026-09-11'),
    );
    expect(result).toMatchObject({
      netWorth: '130500',
      cashFlow: '50',
      baseCurrency: 'DOP',
      balanceStatus: 'COMPLETE',
      totals: {
        accountBalance: '150000',
        cardDebt: '6000',
        income: '80',
        expenses: '30',
      },
    });
  });

  it('returns null net worth when the balance sheet is incomplete', async () => {
    const getCashFlowAggregates = jest.fn().mockResolvedValue([]);
    const getBalanceSheet = jest.fn().mockResolvedValue({
      baseCurrency: 'DOP',
      global: {
        status: 'INCOMPLETE',
        assets: { accounts: '100' },
        liabilities: { creditCards: null, loans: '0' },
        netWorth: null,
        issues: [
          { code: 'MISSING_CREDIT_LIMIT', cardId: 'card-1', currency: 'DOP' },
        ],
      },
    });

    const result = await createService(
      { getCashFlowAggregates },
      { getBalanceSheet },
    ).getAnalyticsSummary('user-1');

    expect(result.netWorth).toBeNull();
    expect(result.totals.cardDebt).toBeNull();
    expect(result.cashFlow).toBe('0');
    expect(result.balanceStatus).toBe('INCOMPLETE');
    expect(result.balanceIssues).toHaveLength(1);
  });

  it('does not count TRANSFER aggregate rows as income or expenses', async () => {
    const getCashFlowAggregates = jest.fn().mockResolvedValue([
      {
        type: 'TRANSFER',
        status: 'CONFIRMED',
        _sum: { amountBaseCurrency: 100 },
      },
      {
        type: 'DEBIT',
        status: 'CONFIRMED',
        _sum: { amountBaseCurrency: 10 },
      },
    ]);
    const getBalanceSheet = jest.fn().mockResolvedValue({
      baseCurrency: 'DOP',
      global: {
        status: 'COMPLETE',
        assets: { accounts: '0' },
        liabilities: { creditCards: '0', loans: '0' },
        netWorth: '0',
        issues: [],
      },
    });

    const result = await createService(
      { getCashFlowAggregates },
      { getBalanceSheet },
    ).getAnalyticsSummary('user-1');

    expect(result.totals.income).toBe('0');
    expect(result.totals.expenses).toBe('10');
    expect(result.cashFlow).toBe('-10');
  });
});
