import { Injectable } from '@nestjs/common';
import { paginationArgs, type PaginationQueryDto } from '@personal-os/core';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import type { LoanInstallmentPlan } from '../domain/loan-installment-schedule';

@Injectable()
export class PlanningRepository {
  constructor(private readonly prisma: PrismaService) {}

  listBudgets(userId: string) {
    return this.prisma.finBudget.findMany({
      where: { userId },
      include: { category: true },
      orderBy: { periodStart: 'desc' },
    });
  }

  listBudgetsPage(userId: string, query: PaginationQueryDto) {
    const { skip, take } = paginationArgs(query);
    return Promise.all([
      this.prisma.finBudget.findMany({
        where: { userId },
        include: { category: true },
        orderBy: { periodStart: 'desc' },
        skip,
        take,
      }),
      this.prisma.finBudget.count({ where: { userId } }),
    ]);
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
    return this.prisma.finBudget.deleteMany({ where: { id, userId } });
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

  createSavingsGoal(
    userId: string,
    data: Omit<Prisma.FinSavingsGoalUncheckedCreateInput, 'userId'>,
  ) {
    return this.prisma.finSavingsGoal.create({ data: { ...data, userId } });
  }

  updateSavingsGoal(
    userId: string,
    id: string,
    data: Prisma.FinSavingsGoalUncheckedUpdateManyInput,
  ) {
    return this.prisma.finSavingsGoal
      .updateMany({ where: { id, userId }, data })
      .then(async (result) => {
        if (result.count === 0) {
          return null;
        }
        return this.findSavingsGoal(userId, id);
      });
  }

  deleteSavingsGoal(userId: string, id: string) {
    return this.prisma.finSavingsGoal.deleteMany({ where: { id, userId } });
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
    return this.prisma.finLoan.deleteMany({ where: { id, userId } });
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
            paidAt: row.paidAt,
          },
          update: {
            dueDate: row.dueDate,
            amount: row.amount,
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
    paidAt: Date,
  ): Promise<void> {
    await this.prisma.finLoanInstallment.update({
      where: { id: installmentId },
      data: { paidAt },
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

  createReceivable(
    userId: string,
    data: Omit<Prisma.FinReceivableUncheckedCreateInput, 'userId'>,
  ) {
    return this.prisma.finReceivable.create({ data: { ...data, userId } });
  }

  deleteReceivable(userId: string, id: string) {
    return this.prisma.finReceivable.deleteMany({ where: { id, userId } });
  }

  updateReceivable(
    userId: string,
    id: string,
    data: Prisma.FinReceivableUncheckedUpdateManyInput,
  ) {
    return this.prisma.finReceivable
      .updateMany({ where: { id, userId }, data })
      .then(async (result) => {
        if (result.count === 0) {
          return null;
        }
        return this.prisma.finReceivable.findFirst({ where: { id, userId } });
      });
  }
}
