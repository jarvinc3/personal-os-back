import { PlanningService } from './planning.service';
import type { SyncLoanInstallmentsUseCase } from './sync-loan-installments.use-case';
import type { PlanningBudgetRepository } from '../infrastructure/planning-budget.repository';
import type { PlanningLoanRepository } from '../infrastructure/planning-loan.repository';
import type { PlanningReceivableRepository } from '../infrastructure/planning-receivable.repository';
import type { PlanningSavingsGoalRepository } from '../infrastructure/planning-savings-goal.repository';
import type { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import type { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import type { AdjustBalanceUseCase } from '../../ledger/application/adjust-balance.use-case';
import type { DeleteTransactionUseCase } from '../../ledger/application/delete-transaction.use-case';

describe('PlanningService budgets', () => {
  const now = new Date('2026-11-01T12:00:00.000Z');
  const listTransactions = jest.fn().mockResolvedValue({
    items: [],
    nextCursor: null,
    hasMore: false,
  });
  const ledger = { listTransactions } as unknown as LedgerQueryService;
  const ownership = {} as FinanceOwnershipService;
  const syncInstallments = {
    execute: jest.fn().mockResolvedValue(undefined),
  } as unknown as SyncLoanInstallmentsUseCase;

  function createService(repo: PlanningBudgetRepository): PlanningService {
    return new PlanningService(
      repo,
      {} as unknown as PlanningSavingsGoalRepository,
      {} as unknown as PlanningLoanRepository,
      {} as unknown as PlanningReceivableRepository,
      ownership,
      syncInstallments,
      ledger,
      {} as unknown as AdjustBalanceUseCase,
      {} as unknown as DeleteTransactionUseCase,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists a budget movements over its whole category set and subcategories', async () => {
    const findBudget = jest.fn().mockResolvedValue({
      id: 'budget-1',
      userId: 'user-1',
      includeChildren: true,
      periodStart: new Date('2026-10-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-31T00:00:00.000Z'),
      categories: [{ categoryId: 'cat-1' }, { categoryId: 'cat-2' }],
    });
    const listChildCategoryIds = jest.fn().mockResolvedValue(['child-1']);
    const repo = {
      findBudget,
      listChildCategoryIds,
    } as unknown as PlanningBudgetRepository;
    const service = createService(repo);

    await service.getBudgetTransactions('user-1', 'budget-1', {
      limit: 20,
    });

    expect(listTransactions).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        categoryIds: ['cat-1', 'cat-2', 'child-1'],
        type: 'DEBIT',
        status: 'CONFIRMED',
        dateTo: '2026-10-31T23:59:59.999Z',
      }),
    );
  });

  it('creates the next period of a recurring budget once', async () => {
    const findOverlappingBudgetForCategories = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'next-1' });
    const createBudget = jest.fn().mockResolvedValue('next-1');
    const findPreviousBudgetForCategories = jest.fn().mockResolvedValue(null);
    const updateBudget = jest.fn().mockResolvedValue('next-1');
    const listRecurringBudgets = jest.fn().mockResolvedValue([
      {
        id: 'budget-1',
        userId: 'user-1',
        name: 'Comida',
        includeChildren: true,
        rollover: 'NONE',
        recurring: true,
        periodType: 'MONTHLY',
        periodStart: new Date('2026-10-01T00:00:00.000Z'),
        periodEnd: new Date('2026-10-31T00:00:00.000Z'),
        amountLimit: 1000,
        amountSpent: 0,
        alertThresholdPct: 80,
        categories: [{ categoryId: 'cat-1' }],
      },
    ]);
    const repo = {
      listRecurringBudgets,
      findOverlappingBudgetForCategories,
      createBudget,
      findPreviousBudgetForCategories,
      updateBudget,
      findBudget: jest.fn().mockResolvedValue({
        id: 'next-1',
        rollover: 'NONE',
        periodStart: new Date('2026-11-01T00:00:00.000Z'),
        categories: [{ categoryId: 'cat-1' }],
      }),
    } as unknown as PlanningBudgetRepository;
    const service = createService(repo);

    await expect(service.createRecurringBudgets(now)).resolves.toEqual({
      created: 1,
    });
    expect(createBudget).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        periodStart: new Date('2026-11-01T00:00:00.000Z'),
        periodEnd: new Date('2026-11-30T00:00:00.000Z'),
        amountSpent: 0,
      }),
      ['cat-1'],
    );

    await expect(service.createRecurringBudgets(now)).resolves.toEqual({
      created: 0,
    });
    expect(createBudget).toHaveBeenCalledTimes(1);
  });
});
