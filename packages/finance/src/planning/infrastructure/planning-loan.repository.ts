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

/** Loans of a user: their terms, institution and deletion journal. */
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
      include: {
        account: { select: { id: true, name: true } },
        disbursementAccount: { select: { id: true, name: true } },
        institution: { select: { id: true, name: true } },
      },
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
      include: {
        account: { select: { id: true, name: true } },
        disbursementAccount: { select: { id: true, name: true } },
        institution: { select: { id: true, name: true } },
      },
      take: limit + 1,
    });
  }

  findLoan(userId: string, id: string) {
    return this.prisma.finLoan.findFirst({
      where: { id, userId },
      include: {
        account: { select: { id: true, name: true } },
        disbursementAccount: { select: { id: true, name: true } },
        institution: { select: { id: true, name: true } },
      },
    });
  }

  findLoansByIds(userId: string, ids: readonly string[]) {
    return this.prisma.finLoan.findMany({
      where: { id: { in: [...ids] }, userId },
      include: {
        account: { select: { id: true, name: true } },
        disbursementAccount: { select: { id: true, name: true } },
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
        disbursementAccount: { select: { id: true, name: true } },
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
    return this.journal.restore({
      userId,
      entityType: DELETION_ENTITY.loan,
      entityId: id,
      now,
    });
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

  findLoanPaymentCategoryId() {
    return this.prisma.finCategory
      .findFirst({
        where: { isSystem: true, systemKind: 'LOAN_PAYMENT', type: 'EXPENSE' },
        select: { id: true },
      })
      .then((category) => category?.id ?? null);
  }

  updateLoan(
    userId: string,
    id: string,
    data: Prisma.FinLoanUncheckedUpdateManyInput,
  ) {
    return this.prisma.finLoan
      .updateMany({ where: { id, userId }, data })
      .then((updateResult) => {
        if (updateResult.count === 0) {
          return null;
        }
        return this.prisma.finLoan.findFirst({
          where: { id, userId },
          include: {
            account: { select: { id: true, name: true } },
            disbursementAccount: { select: { id: true, name: true } },
            institution: { select: { id: true, name: true } },
          },
        });
      });
  }
}
