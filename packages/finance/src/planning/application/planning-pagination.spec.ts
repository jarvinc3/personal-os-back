import { PlanningService } from './planning.service';
import type { PlanningRepository } from '../infrastructure/planning.repository';
import type { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import type { SyncLoanInstallmentsUseCase } from './sync-loan-installments.use-case';
import type { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import type { AdjustBalanceUseCase } from '../../ledger/application/adjust-balance.use-case';
import type { DeleteTransactionUseCase } from '../../ledger/application/delete-transaction.use-case';

function createService(repo: PlanningRepository): PlanningService {
  return new PlanningService(
    {
      budgets: repo,
      savingsGoals: repo,
      loans: repo,
      loanSchedule: repo,
      receivables: repo,
      users: repo,
    } as unknown as PlanningRepository,
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
    const repo = {
      listSavingsGoalsPage: jest.fn().mockResolvedValue(rows),
    } as unknown as PlanningRepository;

    const page = await createService(repo).listSavingsGoalsPage('user-1', {
      limit: 20,
    });

    expect(page.items).toHaveLength(20);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
  });

  it('pages loans oldest due date first and ends the list', async () => {
    const repo = {
      listLoansPage: jest.fn().mockResolvedValue([loanRow(1), loanRow(2)]),
    } as unknown as PlanningRepository;

    const page = await createService(repo).listLoansPage('user-1', {
      limit: 20,
    });

    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('pages receivables and exposes a cursor keyed by createdAt', async () => {
    const repo = {
      listReceivablesPage: jest
        .fn()
        .mockResolvedValue([
          receivableRow(1),
          receivableRow(2),
          receivableRow(3),
        ]),
    } as unknown as PlanningRepository;

    const page = await createService(repo).listReceivablesPage('user-1', {
      limit: 2,
    });

    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    const decoded = JSON.parse(
      Buffer.from(String(page.nextCursor ?? ''), 'base64url').toString('utf8'),
    );
    expect(decoded.key).toBe('2020-01-02T00:00:00.000Z');
    expect(decoded.id).toBe('rec-2');
  });
});
