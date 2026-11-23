import { Injectable } from '@nestjs/common';
import { clampPageLimit, type CursorQueryDto } from '@personal-os/core';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import {
  DELETION_ENTITY,
  DELETION_MODEL,
  toDeletionValues,
} from '../../shared/domain/deletion-snapshot';
import { decodeCursorPosition } from '../../shared/infrastructure/cursor-window';
import { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';
import type { LoanInstallmentPlan } from '../domain/loan-installment-schedule';

/** Bank and account names shown next to every loan row. */
const LOAN_INCLUDES = {
  account: { select: { id: true, name: true } },
  disbursementAccount: { select: { id: true, name: true } },
  institution: { select: { id: true, name: true } },
} satisfies Prisma.FinLoanInclude;

/** Loans: their cursor page, their instalments, their payments and their deletion. */
@Injectable()
export class PlanningLoanRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: DeletionJournalRepository,
  ) {}

  listLoans(userId: string) {
    return this.prisma.finLoan.findMany({
      where: { userId, isActive: true },
      orderBy: { nextDueDate: 'asc' },
      include: LOAN_INCLUDES,
    });
  }

  listLoansPage(userId: string, query: CursorQueryDto) {
    const limit = clampPageLimit(query.limit);
    const after = decodeCursorPosition(query.cursor);
    return this.prisma.finLoan.findMany({
      where: {
        userId,
        isActive: true,
        ...(after
          ? {
              OR: [
                { nextDueDate: { gt: after.date } },
                { nextDueDate: after.date, id: { gt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ nextDueDate: 'asc' }, { id: 'asc' }],
      include: LOAN_INCLUDES,
      take: limit + 1,
    });
  }

  findLoan(userId: string, id: string) {
    return this.prisma.finLoan.findFirst({
      where: { id, userId },
      include: LOAN_INCLUDES,
    });
  }

  findLoansByIds(userId: string, ids: readonly string[]) {
    return this.prisma.finLoan.findMany({
      where: { id: { in: [...ids] }, userId },
      include: LOAN_INCLUDES,
    });
  }

  createLoan(
    userId: string,
    data: Omit<Prisma.FinLoanUncheckedCreateInput, 'userId'>,
  ) {
    return this.prisma.finLoan.create({
      data: { ...data, userId },
      include: LOAN_INCLUDES,
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

  listInstallmentsPage(loanId: string, query: CursorQueryDto) {
    const limit = clampPageLimit(query.limit);
    const after = decodeCursorPosition(query.cursor);
    return this.prisma.finLoanInstallment.findMany({
      where: {
        loanId,
        ...(after
          ? {
              OR: [
                { dueDate: { gt: after.date } },
                { dueDate: after.date, id: { gt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: limit + 1,
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

  findInstallmentForUser(userId: string, installmentId: string) {
    return this.prisma.finLoanInstallment.findFirst({
      where: { id: installmentId, loan: { userId } },
      include: { loan: true },
    });
  }

  findInstallmentByTransactionId(userId: string, transactionId: string) {
    return this.prisma.finLoanInstallment.findFirst({
      where: { transactionId, loan: { userId } },
      include: { loan: true },
    });
  }

  /** Timezone the prepayment resolves its local day with. */
  async findUserTimezone(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return user?.timezone ?? null;
  }

  updateLoan(
    userId: string,
    id: string,
    data: Prisma.FinLoanUncheckedUpdateManyInput,
  ) {
    return this.prisma.finLoan
      .updateMany({ where: { id, userId }, data })
      .then(async (updated) => {
        if (updated.count === 0) {
          return null;
        }
        return this.prisma.finLoan.findFirst({
          where: { id, userId },
          include: LOAN_INCLUDES,
        });
      });
  }
}
