import { PlanningService } from './planning.service';
import type { PlanningBudgetRepository } from '../infrastructure/planning-budget.repository';
import type { PlanningLoanRepository } from '../infrastructure/planning-loan.repository';
import type { PlanningReceivableRepository } from '../infrastructure/planning-receivable.repository';
import type { PlanningSavingsGoalRepository } from '../infrastructure/planning-savings-goal.repository';
import type { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import type { SyncLoanInstallmentsUseCase } from './sync-loan-installments.use-case';
import type { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import type { AdjustBalanceUseCase } from '../../ledger/application/adjust-balance.use-case';
import type { DeleteTransactionUseCase } from '../../ledger/application/delete-transaction.use-case';

type PlanningRepositories = {
  budgets?: PlanningBudgetRepository;
  savingsGoals?: PlanningSavingsGoalRepository;
  loans?: PlanningLoanRepository;
  receivables?: PlanningReceivableRepository;
};

function createService({
  budgets = {} as PlanningBudgetRepository,
  savingsGoals = {} as PlanningSavingsGoalRepository,
  loans = {} as PlanningLoanRepository,
  receivables = {} as PlanningReceivableRepository,
}: PlanningRepositories = {}): PlanningService {
  return new PlanningService(
    budgets,
    savingsGoals,
    loans,
    receivables,
    {} as unknown as FinanceOwnershipService,
    {} as unknown as SyncLoanInstallmentsUseCase,
    {} as unknown as LedgerQueryService,
    {} as unknown as AdjustBalanceUseCase,
    {} as unknown as DeleteTransactionUseCase,
  );
}

function savingsGoalRow(index: number) {
  return {
    id: `goal-${index}`,
    userId: 'user-1',
    targetAmount: 0,
    currentAmount: 0,
    createdAt: new Date(`2020-01-${String(index).padStart(2, '0')}T00:00:00Z`),
  };
}

function loanRow(index: number) {
  return {
    id: `loan-${index}`,
    userId: 'user-1',
    originalAmount: 0,
    currentBalance: 0,
    installmentAmount: 0,
    interestRate: null,
    nextDueDate: new Date(
      `2020-01-${String(index).padStart(2, '0')}T00:00:00Z`,
    ),
  };
}

function receivableRow(index: number) {
  return {
    id: `rec-${index}`,
    userId: 'user-1',
    amount: 0,
    paidAmount: 0,
    createdAt: new Date(`2020-01-${String(index).padStart(2, '0')}T00:00:00Z`),
  };
}

describe('PlanningService pagination', () => {
  it('pages savings goals with a next cursor when more rows exist', async () => {
    const rows = Array.from({ length: 21 }, (_, index) =>
      savingsGoalRow(index + 1),
    );
    const savingsGoals = {
      listSavingsGoalsPage: jest.fn().mockResolvedValue(rows),
    } as unknown as PlanningSavingsGoalRepository;

    const page = await createService({ savingsGoals }).listSavingsGoalsPage(
      'user-1',
      { limit: 20 },
    );

    expect(page.items).toHaveLength(20);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
  });

  it('pages loans oldest due date first and ends the list', async () => {
    const loans = {
      listLoansPage: jest.fn().mockResolvedValue([loanRow(1), loanRow(2)]),
    } as unknown as PlanningLoanRepository;

    const page = await createService({ loans }).listLoansPage('user-1', {
      limit: 20,
    });

    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('pages receivables and exposes a cursor keyed by createdAt', async () => {
    const receivables = {
      listReceivablesPage: jest
        .fn()
        .mockResolvedValue([
          receivableRow(1),
          receivableRow(2),
          receivableRow(3),
        ]),
    } as unknown as PlanningReceivableRepository;

    const page = await createService({ receivables }).listReceivablesPage(
      'user-1',
      { limit: 2 },
    );

    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    const decoded = JSON.parse(
      Buffer.from(page.nextCursor ?? '', 'base64url').toString('utf8'),
    );
    expect(decoded.key).toBe('2020-01-02T00:00:00.000Z');
    expect(decoded.id).toBe('rec-2');
  });
});
