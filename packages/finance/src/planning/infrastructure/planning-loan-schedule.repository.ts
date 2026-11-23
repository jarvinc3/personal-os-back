import { Injectable } from '@nestjs/common';
import { clampPageLimit, type CursorQueryDto } from '@personal-os/core';
import { PrismaService } from '@personal-os/database';
import type { LoanInstallmentPlan } from '../domain/loan-installment-schedule';
import { decodeCursorPosition } from '../../shared/infrastructure/cursor-window';

/** Instalments and prepayments of a loan: their plan and paid amounts. */
@Injectable()
export class PlanningLoanScheduleRepository {
  constructor(private readonly prisma: PrismaService) {}

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
}
