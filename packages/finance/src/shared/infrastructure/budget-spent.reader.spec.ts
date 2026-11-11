import { Prisma } from '@personal-os/database';
import type { PrismaService } from '@personal-os/database';
import { budgetCategoryIds, sumBudgetSpent } from './budget-spent.reader';

const PERIOD_START = new Date('2026-10-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-10-31T00:00:00.000Z');

function createPrisma(options?: {
  total?: string | null;
  refund?: string | null;
  children?: string[];
}) {
  const sum = (value: string | null | undefined) => ({
    _sum: {
      amountBaseCurrency:
        value === null ? null : new Prisma.Decimal(value ?? '0'),
    },
  });
  const aggregate = jest
    .fn()
    .mockResolvedValueOnce(sum(options?.total))
    .mockResolvedValueOnce(sum(options?.refund));
  const findMany = jest
    .fn()
    .mockResolvedValue((options?.children ?? []).map((id) => ({ id })));
  const prisma = {
    finTransaction: { aggregate },
    finCategory: { findMany },
  } as unknown as PrismaService;

  return { prisma, aggregate, findMany };
}

describe('sumBudgetSpent', () => {
  it('sums confirmed debits of the budget categories inside the period', async () => {
    const { prisma, aggregate, findMany } = createPrisma({ total: '120.50' });

    const total = await sumBudgetSpent(prisma, {
      userId: 'user-1',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      categoryIds: ['cat-1'],
      includeChildren: false,
    });

    expect(total.toString()).toBe('120.5');
    expect(aggregate).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        type: 'DEBIT',
        status: 'CONFIRMED',
        categoryId: { in: ['cat-1'] },
        transactionDate: {
          gte: PERIOD_START,
          lte: new Date('2026-10-31T23:59:59.999Z'),
        },
      },
      _sum: { amountBaseCurrency: true },
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('subtracts the linked refunds inside the period', async () => {
    const { prisma, aggregate } = createPrisma({
      total: '120.50',
      refund: '20.50',
    });

    const total = await sumBudgetSpent(prisma, {
      userId: 'user-1',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      categoryIds: ['cat-1'],
      includeChildren: false,
    });

    expect(total.toString()).toBe('100');
    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(aggregate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: 'CREDIT',
          status: 'CONFIRMED',
          linkedTransactionId: { not: null },
        }),
      }),
    );
  });

  it('never reports a negative spent amount', async () => {
    const { prisma } = createPrisma({ total: '10', refund: '30' });

    const total = await sumBudgetSpent(prisma, {
      userId: 'user-1',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      categoryIds: ['cat-1'],
      includeChildren: false,
    });

    expect(total.toString()).toBe('0');
  });

  it('adds the child categories when the budget includes them', async () => {
    const { prisma, aggregate, findMany } = createPrisma({
      total: '50',
      children: ['child-1', 'child-2'],
    });

    await sumBudgetSpent(prisma, {
      userId: 'user-1',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      categoryIds: ['cat-1'],
      includeChildren: true,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: { parentId: { in: ['cat-1'] } },
      select: { id: true },
    });
    expect(aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          categoryId: { in: ['cat-1', 'child-1', 'child-2'] },
        }),
      }),
    );
  });

  it('returns zero without querying when the budget has no categories', async () => {
    const { prisma, aggregate } = createPrisma();

    const total = await sumBudgetSpent(prisma, {
      userId: 'user-1',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      categoryIds: [],
      includeChildren: true,
    });

    expect(total.toString()).toBe('0');
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('returns zero when the movements have no summed amount', async () => {
    const { prisma } = createPrisma({ total: null });

    const total = await sumBudgetSpent(prisma, {
      userId: 'user-1',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      categoryIds: ['cat-1'],
      includeChildren: false,
    });

    expect(total.toString()).toBe('0');
  });
});

describe('budgetCategoryIds', () => {
  it('merges the legacy category column with the join rows', () => {
    expect(
      budgetCategoryIds({
        categoryId: 'cat-1',
        categories: [{ categoryId: 'cat-1' }, { categoryId: 'cat-2' }],
      }),
    ).toEqual(['cat-1', 'cat-2']);
  });

  it('keeps budgets that only have the join rows', () => {
    expect(
      budgetCategoryIds({
        categoryId: null,
        categories: [{ categoryId: 'c' }],
      }),
    ).toEqual(['c']);
  });
});
