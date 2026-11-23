import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';
import { PlanningBudgetRepository } from './planning-budget.repository';
import { PlanningLoanScheduleRepository } from './planning-loan-schedule.repository';
import { PlanningLoanRepository } from './planning-loan.repository';
import { PlanningReceivableRepository } from './planning-receivable.repository';
import { PlanningSavingsGoalRepository } from './planning-savings-goal.repository';
import { PlanningUserTimezoneRepository } from './planning-user-timezone.repository';

/**
 * Planning exposes one repository per aggregate. The aggregate services
 * receive only their own piece; this composition covers the use cases that
 * link a movement with a budget, a goal, an instalment or a receivable.
 */
@Injectable()
export class PlanningRepository {
  readonly budgets: PlanningBudgetRepository;
  readonly savingsGoals: PlanningSavingsGoalRepository;
  readonly loans: PlanningLoanRepository;
  readonly loanSchedule: PlanningLoanScheduleRepository;
  readonly receivables: PlanningReceivableRepository;
  readonly users: PlanningUserTimezoneRepository;

  constructor(prisma: PrismaService, journal: DeletionJournalRepository) {
    this.budgets = new PlanningBudgetRepository(prisma, journal);
    this.savingsGoals = new PlanningSavingsGoalRepository(prisma, journal);
    this.loans = new PlanningLoanRepository(prisma, journal);
    this.loanSchedule = new PlanningLoanScheduleRepository(prisma);
    this.receivables = new PlanningReceivableRepository(prisma, journal);
    this.users = new PlanningUserTimezoneRepository(prisma);
  }

  findUserTimezone(userId: string) {
    return this.users.findUserTimezone(userId);
  }

  findSavingsGoal(userId: string, id: string) {
    return this.savingsGoals.findSavingsGoal(userId, id);
  }

  findSavingsGoalContribution(goalId: string, contributionId: string) {
    return this.savingsGoals.findSavingsGoalContribution(
      goalId,
      contributionId,
    );
  }

  findSavingsGoalContributionByTransactionId(
    userId: string,
    transactionId: string,
  ) {
    return this.savingsGoals.findSavingsGoalContributionByTransactionId(
      userId,
      transactionId,
    );
  }

  findTransactionByTransferGroupId(userId: string, transferGroupId: string) {
    return this.savingsGoals.findTransactionByTransferGroupId(
      userId,
      transferGroupId,
    );
  }

  addSavingsGoalContribution(
    goalId: string,
    contribution: Parameters<
      PlanningSavingsGoalRepository['addSavingsGoalContribution']
    >[1],
    now: Date,
  ) {
    return this.savingsGoals.addSavingsGoalContribution(
      goalId,
      contribution,
      now,
    );
  }

  removeSavingsGoalContribution(
    goalId: string,
    contributionId: string,
    now: Date,
  ) {
    return this.savingsGoals.removeSavingsGoalContribution(
      goalId,
      contributionId,
      now,
    );
  }

  sumEarmarkedByAccount(userId: string, accountId: string) {
    return this.savingsGoals.sumEarmarkedByAccount(userId, accountId);
  }

  findLoan(userId: string, id: string) {
    return this.loans.findLoan(userId, id);
  }

  findLoanPaymentCategoryId() {
    return this.loans.findLoanPaymentCategoryId();
  }

  listLoansForScheduleSync() {
    return this.loans.listLoansForScheduleSync();
  }

  updateLoan(
    userId: string,
    id: string,
    data: Parameters<PlanningLoanRepository['updateLoan']>[2],
  ) {
    return this.loans.updateLoan(userId, id, data);
  }

  listInstallments(loanId: string) {
    return this.loanSchedule.listInstallments(loanId);
  }

  findNextUnpaidInstallment(loanId: string) {
    return this.loanSchedule.findNextUnpaidInstallment(loanId);
  }

  createLoanPrepayment(
    input: Parameters<
      PlanningLoanScheduleRepository['createLoanPrepayment']
    >[0],
  ) {
    return this.loanSchedule.createLoanPrepayment(input);
  }

  replaceLoanSchedule(
    loanId: string,
    rows: Parameters<PlanningLoanScheduleRepository['replaceLoanSchedule']>[1],
  ) {
    return this.loanSchedule.replaceLoanSchedule(loanId, rows);
  }

  applyInstallmentPayment(
    installmentId: string,
    input: Parameters<
      PlanningLoanScheduleRepository['applyInstallmentPayment']
    >[1],
  ) {
    return this.loanSchedule.applyInstallmentPayment(installmentId, input);
  }

  findInstallmentForUser(userId: string, installmentId: string) {
    return this.loanSchedule.findInstallmentForUser(userId, installmentId);
  }

  findInstallmentByTransactionId(userId: string, transactionId: string) {
    return this.loanSchedule.findInstallmentByTransactionId(
      userId,
      transactionId,
    );
  }

  findReceivable(userId: string, id: string) {
    return this.receivables.findReceivable(userId, id);
  }

  createReceivablePayment(
    receivableId: string,
    payment: Parameters<
      PlanningReceivableRepository['createReceivablePayment']
    >[1],
  ) {
    return this.receivables.createReceivablePayment(receivableId, payment);
  }

  findReceivablePaymentByTransactionId(userId: string, transactionId: string) {
    return this.receivables.findReceivablePaymentByTransactionId(
      userId,
      transactionId,
    );
  }

  deleteReceivablePayment(receivableId: string, paymentId: string) {
    return this.receivables.deleteReceivablePayment(receivableId, paymentId);
  }

  findExtraIncomeCategoryId() {
    return this.receivables.findExtraIncomeCategoryId();
  }

  addReceivableCreditBalance(receivableId: string, amount: number) {
    return this.receivables.addReceivableCreditBalance(receivableId, amount);
  }

  applyReceivableCredit(
    input: Parameters<PlanningReceivableRepository['applyReceivableCredit']>[0],
  ) {
    return this.receivables.applyReceivableCredit(input);
  }

  writeOffReceivable(
    receivableId: string,
    input: Parameters<PlanningReceivableRepository['writeOffReceivable']>[1],
  ) {
    return this.receivables.writeOffReceivable(receivableId, input);
  }
}
