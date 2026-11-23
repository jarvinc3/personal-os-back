import { Injectable } from '@nestjs/common';
import { type CursorQueryDto } from '@personal-os/core';
import { AdjustBalanceUseCase } from '../../ledger/application/adjust-balance.use-case';
import { DeleteTransactionUseCase } from '../../ledger/application/delete-transaction.use-case';
import { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { PlanningBudgetRepository } from '../infrastructure/planning-budget.repository';
import { PlanningLoanRepository } from '../infrastructure/planning-loan.repository';
import { PlanningReceivableRepository } from '../infrastructure/planning-receivable.repository';
import { PlanningSavingsGoalRepository } from '../infrastructure/planning-savings-goal.repository';
import type { CreateBudgetDto } from '../presentation/dto/create-budget.dto';
import type { CreateLoanDto } from '../presentation/dto/create-loan.dto';
import type { CreateReceivableDto } from '../presentation/dto/create-receivable.dto';
import type { CreateSavingsGoalDto } from '../presentation/dto/create-savings-goal.dto';
import type { UpdateBudgetDto } from '../presentation/dto/update-budget.dto';
import type { UpdateLoanDto } from '../presentation/dto/update-loan.dto';
import type { UpdateReceivableDto } from '../presentation/dto/update-receivable.dto';
import type { UpdateSavingsGoalDto } from '../presentation/dto/update-savings-goal.dto';
import { PlanningBudgets } from './planning-budgets';
import { PlanningLoans } from './planning-loans';
import { PlanningReceivables } from './planning-receivables';
import { PlanningSavingsGoals } from './planning-savings-goals';
import { SyncLoanInstallmentsUseCase } from './sync-loan-installments.use-case';

@Injectable()
export class PlanningService {
  private readonly budgets: PlanningBudgets;
  private readonly savingsGoals: PlanningSavingsGoals;
  private readonly loans: PlanningLoans;
  private readonly receivables: PlanningReceivables;

  constructor(
    budgets: PlanningBudgetRepository,
    savingsGoals: PlanningSavingsGoalRepository,
    loans: PlanningLoanRepository,
    receivables: PlanningReceivableRepository,
    ownership: FinanceOwnershipService,
    syncInstallments: SyncLoanInstallmentsUseCase,
    ledger: LedgerQueryService,
    adjustBalance: AdjustBalanceUseCase,
    deleteTransaction: DeleteTransactionUseCase,
  ) {
    this.budgets = new PlanningBudgets(budgets, ownership, ledger);
    this.savingsGoals = new PlanningSavingsGoals(savingsGoals, ownership);
    this.loans = new PlanningLoans({
      repo: loans,
      ownership,
      syncInstallments,
      adjustBalance,
      deleteTransaction,
    });
    this.receivables = new PlanningReceivables(receivables);
  }

  listBudgets(userId: string) {
    return this.budgets.listBudgets(userId);
  }

  listBudgetsPage(userId: string, query: CursorQueryDto) {
    return this.budgets.listBudgetsPage(userId, query);
  }

  getBudget(userId: string, id: string) {
    return this.budgets.getBudget(userId, id);
  }

  lookupBudgets(userId: string, ids: readonly string[]) {
    return this.budgets.lookupBudgets(userId, ids);
  }

  createBudget(userId: string, dto: CreateBudgetDto) {
    return this.budgets.createBudget(userId, dto);
  }

  updateBudget(userId: string, id: string, dto: UpdateBudgetDto) {
    return this.budgets.updateBudget(userId, id, dto);
  }

  getBudgetTransactions(userId: string, id: string, query: CursorQueryDto) {
    return this.budgets.getBudgetTransactions(userId, id, query);
  }

  createRecurringBudgets(now: Date) {
    return this.budgets.createRecurringBudgets(now);
  }

  deleteBudget(userId: string, id: string) {
    return this.budgets.deleteBudget(userId, id);
  }

  restoreBudget(userId: string, id: string, now: Date) {
    return this.budgets.restoreBudget(userId, id, now);
  }

  listSavingsGoals(userId: string) {
    return this.savingsGoals.listSavingsGoals(userId);
  }

  listSavingsGoalsPage(userId: string, query: CursorQueryDto) {
    return this.savingsGoals.listSavingsGoalsPage(userId, query);
  }

  getSavingsGoal(userId: string, id: string) {
    return this.savingsGoals.getSavingsGoal(userId, id);
  }

  lookupSavingsGoals(userId: string, ids: readonly string[]) {
    return this.savingsGoals.lookupSavingsGoals(userId, ids);
  }

  createSavingsGoal(userId: string, dto: CreateSavingsGoalDto, now: Date) {
    return this.savingsGoals.createSavingsGoal(userId, dto, now);
  }

  // eslint-disable-next-line max-params
  updateSavingsGoal(
    userId: string,
    id: string,
    dto: UpdateSavingsGoalDto,
    now: Date,
  ) {
    return this.savingsGoals.updateSavingsGoal(userId, id, dto, now);
  }

  deleteSavingsGoal(userId: string, id: string) {
    return this.savingsGoals.deleteSavingsGoal(userId, id);
  }

  restoreSavingsGoal(userId: string, id: string, now: Date) {
    return this.savingsGoals.restoreSavingsGoal(userId, id, now);
  }

  listSavingsGoalContributions(
    userId: string,
    id: string,
    query: CursorQueryDto,
  ) {
    return this.savingsGoals.listSavingsGoalContributions(userId, id, query);
  }

  listLoans(userId: string) {
    return this.loans.listLoans(userId);
  }

  listLoansPage(userId: string, query: CursorQueryDto) {
    return this.loans.listLoansPage(userId, query);
  }

  getLoan(userId: string, id: string) {
    return this.loans.getLoan(userId, id);
  }

  lookupLoans(userId: string, ids: readonly string[]) {
    return this.loans.lookupLoans(userId, ids);
  }

  listLoanInstallments(userId: string, id: string) {
    return this.loans.listLoanInstallments(userId, id);
  }

  listLoanInstallmentsPage(userId: string, id: string, query: CursorQueryDto) {
    return this.loans.listLoanInstallmentsPage(userId, id, query);
  }

  createLoan(userId: string, dto: CreateLoanDto, now: Date) {
    return this.loans.createLoan(userId, dto, now);
  }

  // eslint-disable-next-line max-params
  updateLoan(userId: string, id: string, dto: UpdateLoanDto, now: Date) {
    return this.loans.updateLoan(userId, id, dto, now);
  }

  deactivateLoan(userId: string, id: string) {
    return this.loans.deactivateLoan(userId, id);
  }

  deleteLoan(userId: string, id: string) {
    return this.loans.deleteLoan(userId, id);
  }

  restoreLoan(userId: string, id: string, now: Date) {
    return this.loans.restoreLoan(userId, id, now);
  }

  listReceivables(userId: string) {
    return this.receivables.listReceivables(userId);
  }

  listReceivablesPage(userId: string, query: CursorQueryDto) {
    return this.receivables.listReceivablesPage(userId, query);
  }

  getReceivable(userId: string, id: string) {
    return this.receivables.getReceivable(userId, id);
  }

  lookupReceivables(userId: string, ids: readonly string[]) {
    return this.receivables.lookupReceivables(userId, ids);
  }

  createReceivable(userId: string, dto: CreateReceivableDto) {
    return this.receivables.createReceivable(userId, dto);
  }

  updateReceivable(userId: string, id: string, dto: UpdateReceivableDto) {
    return this.receivables.updateReceivable(userId, id, dto);
  }

  listReceivablePayments(userId: string, id: string, query: CursorQueryDto) {
    return this.receivables.listReceivablePayments(userId, id, query);
  }

  deleteReceivable(userId: string, id: string) {
    return this.receivables.deleteReceivable(userId, id);
  }

  restoreReceivable(userId: string, id: string, now: Date) {
    return this.receivables.restoreReceivable(userId, id, now);
  }
}
