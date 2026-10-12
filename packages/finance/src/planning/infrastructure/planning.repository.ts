import { Injectable } from '@nestjs/common';
import {
  clampPageLimit,
  decodeCursor,
  type CursorQueryDto,
} from '@personal-os/core';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import type { ReceivableStatus } from '../application/resolve-receivable-payment';
import type { LoanInstallmentPlan } from '../domain/loan-installment-schedule';
import {
  DELETION_ENTITY,
  DELETION_MODEL,
  toDeletionValues,
} from '../../shared/domain/deletion-snapshot';
import { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';
import { applyReceivableBalance } from './receivable-balance';
import { applySavingsGoalBalance } from './savings-goal-balance';

/** Label of the row that carries a balance recorded before history existed. */
const OPENING_BALANCE_NOTE = 'Saldo inicial';

@Injectable()
export class PlanningRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: DeletionJournalRepository,
  ) {}

  listBudgets(userId: string) {
    return this.prisma.finBudget.findMany({
      where: { userId },
      include: { category: true },
      orderBy: { periodStart: 'desc' },
    });
  }

  listBudgetsPage(userId: string, query: CursorQueryDto) {
    const limit = clampPageLimit(query.limit);
    const cursorPoint = query.cursor ? decodeCursor(query.cursor) : null;
    const baseWhere: Prisma.FinBudgetWhereInput = { userId };
    const cursorDate = cursorPoint ? new Date(cursorPoint.key) : null;
    const where: Prisma.FinBudgetWhereInput =
      cursorPoint && cursorDate
        ? {
            AND: [
              baseWhere,
              {
                OR: [
                  { periodStart: { lt: cursorDate } },
                  { periodStart: cursorDate, id: { lt: cursorPoint.id } },
                ],
              },
            ],
          }
        : baseWhere;
    return this.prisma.finBudget.findMany({
      where,
      include: { category: true },
      orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  }

  findBudget(userId: string, id: string) {
    return this.prisma.finBudget.findFirst({
      where: { id, userId },
      include: { category: true },
    });
  }

  createBudget(
    userId: string,
    data: Omit<Prisma.FinBudgetUncheckedCreateInput, 'userId'>,
  ) {
    return this.prisma.finBudget.create({
      data: { ...data, userId },
      include: { category: true },
    });
  }

  updateBudget(
    userId: string,
    id: string,
    data: Prisma.FinBudgetUncheckedUpdateManyInput,
  ) {
    return this.prisma.finBudget
      .updateMany({ where: { id, userId }, data })
      .then(async (result) => {
        if (result.count === 0) {
          return null;
        }
        return this.prisma.finBudget.findFirst({
          where: { id, userId },
          include: { category: true },
        });
      });
  }

  deleteBudget(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const budget = await tx.finBudget.findFirst({
        where: { id, userId },
        include: { alerts: true },
      });
      if (!budget) {
        return { count: 0 };
      }
      const { alerts, ...budgetRow } = budget;
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.budget,
        entityId: id,
        snapshot: {
          rows: [
            {
              model: DELETION_MODEL.budget,
              values: toDeletionValues(budgetRow),
            },
            ...alerts.map((alert) => ({
              model: DELETION_MODEL.budgetAlert,
              values: toDeletionValues(alert),
            })),
          ],
        },
      });
      return tx.finBudget.deleteMany({ where: { id, userId } });
    });
  }

  restoreBudget(userId: string, id: string, now: Date) {
    return this.journal.restore(userId, DELETION_ENTITY.budget, id, now);
  }

  listSavingsGoals(userId: string) {
    return this.prisma.finSavingsGoal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findSavingsGoal(userId: string, id: string) {
    return this.prisma.finSavingsGoal.findFirst({ where: { id, userId } });
  }

  async createSavingsGoal(
    userId: string,
    data: Omit<
      Prisma.FinSavingsGoalUncheckedCreateInput,
      'userId' | 'currentAmount'
    >,
    openingAmount: number,
    now: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const goal = await tx.finSavingsGoal.create({
        data: { ...data, userId },
      });
      if (openingAmount > 0) {
        await tx.finSavingsGoalContribution.create({
          data: {
            goalId: goal.id,
            amount: openingAmount,
            contributedAt: goal.createdAt,
            notes: OPENING_BALANCE_NOTE,
          },
        });
      }
      await applySavingsGoalBalance(tx, goal.id, now);
      return this.readSavingsGoal(tx, goal.id);
    });
  }

  async updateSavingsGoal(
    userId: string,
    id: string,
    data: Prisma.FinSavingsGoalUncheckedUpdateManyInput,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.finSavingsGoal.updateMany({ where: { id, userId }, data });
      await applySavingsGoalBalance(tx, id, now);
    });
  }

  deleteSavingsGoal(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const goal = await tx.finSavingsGoal.findFirst({
        where: { id, userId },
        include: { contributions: true },
      });
      if (!goal) {
        return { count: 0 };
      }
      const { contributions, ...goalRow } = goal;
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.savingsGoal,
        entityId: id,
        snapshot: {
          rows: [
            {
              model: DELETION_MODEL.savingsGoal,
              values: toDeletionValues(goalRow),
            },
            ...contributions.map((contribution) => ({
              model: DELETION_MODEL.savingsGoalContribution,
              values: toDeletionValues(contribution),
            })),
          ],
        },
      });
      return tx.finSavingsGoal.deleteMany({ where: { id, userId } });
    });
  }

  restoreSavingsGoal(userId: string, id: string, now: Date) {
    return this.journal.restore(userId, DELETION_ENTITY.savingsGoal, id, now);
  }

  listSavingsGoalContributions(goalId: string) {
    return this.prisma.finSavingsGoalContribution.findMany({
      where: { goalId },
      orderBy: [{ contributedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  findSavingsGoalContribution(goalId: string, contributionId: string) {
    return this.prisma.finSavingsGoalContribution.findFirst({
      where: { id: contributionId, goalId },
    });
  }

  async addSavingsGoalContribution(
    goalId: string,
    contribution: {
      amount: number;
      contributedAt: Date;
      accountId: string;
      transactionId: string;
      notes?: string;
    },
    now: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.finSavingsGoalContribution.create({
        data: { goalId, ...contribution },
      });
      await applySavingsGoalBalance(tx, goalId, now);
      return created;
    });
  }

  async removeSavingsGoalContribution(
    goalId: string,
    contributionId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.finSavingsGoalContribution.deleteMany({
        where: { id: contributionId, goalId },
      });
      await applySavingsGoalBalance(tx, goalId, now);
    });
  }

  private readSavingsGoal(tx: Prisma.TransactionClient, goalId: string) {
    return tx.finSavingsGoal.findUniqueOrThrow({ where: { id: goalId } });
  }

  listLoans(userId: string) {
    return this.prisma.finLoan.findMany({
      where: { userId, isActive: true },
      orderBy: { nextDueDate: 'asc' },
      include: {
        account: { select: { id: true, name: true } },
        institution: { select: { id: true, name: true } },
      },
    });
  }

  findLoan(userId: string, id: string) {
    return this.prisma.finLoan.findFirst({
      where: { id, userId },
      include: {
        account: { select: { id: true, name: true } },
        institution: { select: { id: true, name: true } },
      },
    });
  }

  createLoan(
    userId: string,
    data: Omit<Prisma.FinLoanUncheckedCreateInput, 'userId'>,
  ) {
    return this.prisma.finLoan.create({
      data: { ...data, userId },
      include: {
        account: { select: { id: true, name: true } },
        institution: { select: { id: true, name: true } },
      },
    });
  }

  deleteLoan(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const loan = await tx.finLoan.findFirst({
        where: { id, userId },
        include: { installments: true },
      });
      if (!loan) {
        return { count: 0 };
      }
      const { installments, ...loanRow } = loan;
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.loan,
        entityId: id,
        snapshot: {
          rows: [
            { model: DELETION_MODEL.loan, values: toDeletionValues(loanRow) },
            ...installments.map((installment) => ({
              model: DELETION_MODEL.loanInstallment,
              values: toDeletionValues(installment),
            })),
          ],
        },
      });
      return tx.finLoan.deleteMany({ where: { id, userId } });
    });
  }

  restoreLoan(userId: string, id: string, now: Date) {
    return this.journal.restore(userId, DELETION_ENTITY.loan, id, now);
  }

  listLoansForScheduleSync() {
    return this.prisma.finLoan.findMany({
      where: { isActive: true },
      select: {
        id: true,
        nextDueDate: true,
        paidInstallments: true,
        installmentFreq: true,
        totalInstallments: true,
        installmentAmount: true,
        originalAmount: true,
        currentBalance: true,
        interestRate: true,
        insuranceAmount: true,
      },
    });
  }

  listInstallments(loanId: string) {
    return this.prisma.finLoanInstallment.findMany({
      where: { loanId },
      orderBy: { installmentNo: 'asc' },
    });
  }

  findNextUnpaidInstallment(loanId: string) {
    return this.prisma.finLoanInstallment.findFirst({
      where: { loanId, paidAt: null },
      orderBy: { installmentNo: 'asc' },
    });
  }

  findLoanPaymentCategoryId() {
    return this.prisma.finCategory
      .findFirst({
        where: { isSystem: true, systemKind: 'LOAN_PAYMENT', type: 'EXPENSE' },
        select: { id: true },
      })
      .then((category) => category?.id ?? null);
  }

  createLoanPrepayment(input: {
    loanId: string;
    amount: number;
    penalty: number;
    mode: string;
    paidAt: Date;
    transactionId: string | null;
  }) {
    return this.prisma.finLoanPrepayment.create({ data: input });
  }

  async replaceLoanSchedule(
    loanId: string,
    rows: readonly LoanInstallmentPlan[],
  ): Promise<void> {
    const highestInstallmentNo = rows.reduce(
      (highest, row) => Math.max(highest, row.installmentNo),
      0,
    );
    await this.prisma.$transaction([
      ...rows.map((row) =>
        this.prisma.finLoanInstallment.upsert({
          where: {
            loanId_installmentNo: {
              loanId,
              installmentNo: row.installmentNo,
            },
          },
          create: {
            loanId,
            installmentNo: row.installmentNo,
            dueDate: row.dueDate,
            amount: row.amount,
            principal: row.principal,
            interest: row.interest,
            insurance: row.insurance,
            paidAt: row.paidAt,
            status: row.status,
            paidAmount: row.paidAmount,
            fees: row.fees,
            lateFee: row.lateFee,
          },
          update: {
            dueDate: row.dueDate,
            amount: row.amount,
            principal: row.principal,
            interest: row.interest,
            insurance: row.insurance,
            paidAt: row.paidAt,
          },
        }),
      ),
      this.prisma.finLoanInstallment.deleteMany({
        where: { loanId, installmentNo: { gt: highestInstallmentNo } },
      }),
    ]);
  }

  async markInstallmentPaid(
    installmentId: string,
    paidAt: Date | null,
    transactionId: string | null,
  ): Promise<void> {
    await this.prisma.finLoanInstallment.update({
      where: { id: installmentId },
      data: { paidAt, transactionId },
    });
  }

  async applyInstallmentPayment(
    installmentId: string,
    input: {
      paidAmount: number;
      status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE';
      paidAt: Date | null;
      transactionId: string | null;
    },
  ): Promise<void> {
    await this.prisma.finLoanInstallment.update({
      where: { id: installmentId },
      data: input,
    });
  }

  updateLoan(
    userId: string,
    id: string,
    data: Prisma.FinLoanUncheckedUpdateManyInput,
  ) {
    return this.prisma.finLoan
      .updateMany({ where: { id, userId }, data })
      .then(async (result) => {
        if (result.count === 0) {
          return null;
        }
        return this.prisma.finLoan.findFirst({
          where: { id, userId },
          include: {
            account: { select: { id: true, name: true } },
            institution: { select: { id: true, name: true } },
          },
        });
      });
  }

  listReceivables(userId: string) {
    return this.prisma.finReceivable.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findReceivable(userId: string, id: string) {
    return this.prisma.finReceivable.findFirst({ where: { id, userId } });
  }

  async createReceivable(
    userId: string,
    data: Omit<
      Prisma.FinReceivableUncheckedCreateInput,
      'userId' | 'paidAmount'
    >,
    openingAmount: number,
    requestedStatus: ReceivableStatus | undefined,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const receivable = await tx.finReceivable.create({
        data: { ...data, userId },
      });
      if (openingAmount > 0) {
        await tx.finReceivablePayment.create({
          data: {
            receivableId: receivable.id,
            amount: openingAmount,
            paidAt: receivable.createdAt,
            notes: OPENING_BALANCE_NOTE,
          },
        });
      }
      await applyReceivableBalance(tx, receivable.id, requestedStatus);
      return tx.finReceivable.findUniqueOrThrow({
        where: { id: receivable.id },
      });
    });
  }

  deleteReceivable(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const receivable = await tx.finReceivable.findFirst({
        where: { id, userId },
        include: { payments: true },
      });
      if (!receivable) {
        return { count: 0 };
      }
      const { payments, ...receivableRow } = receivable;
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.receivable,
        entityId: id,
        snapshot: {
          rows: [
            {
              model: DELETION_MODEL.receivable,
              values: toDeletionValues(receivableRow),
            },
            ...payments.map((payment) => ({
              model: DELETION_MODEL.receivablePayment,
              values: toDeletionValues(payment),
            })),
          ],
        },
      });
      return tx.finReceivable.deleteMany({ where: { id, userId } });
    });
  }

  restoreReceivable(userId: string, id: string, now: Date) {
    return this.journal.restore(userId, DELETION_ENTITY.receivable, id, now);
  }

  async updateReceivable(
    userId: string,
    id: string,
    data: Prisma.FinReceivableUncheckedUpdateManyInput,
    requestedStatus: ReceivableStatus | undefined,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.finReceivable.updateMany({ where: { id, userId }, data });
      await applyReceivableBalance(tx, id, requestedStatus);
    });
  }

  listReceivablePayments(receivableId: string) {
    return this.prisma.finReceivablePayment.findMany({
      where: { receivableId },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      include: { account: { select: { id: true, name: true } } },
    });
  }

  findReceivablePayment(receivableId: string, paymentId: string) {
    return this.prisma.finReceivablePayment.findFirst({
      where: { id: paymentId, receivableId },
    });
  }

  async createReceivablePayment(
    receivableId: string,
    payment: {
      amount: number;
      paidAt: Date;
      accountId: string;
      transactionId: string | null;
      notes?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.finReceivablePayment.create({
        data: { receivableId, ...payment },
      });
      await applyReceivableBalance(tx, receivableId);
      return created;
    });
  }
}
