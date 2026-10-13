import { Injectable } from '@nestjs/common';
import {
  buildFrenchSchedule,
  type LoanInstallmentFrequency,
  type LoanInstallmentPlan,
} from '../domain/loan-installment-schedule';
import { PlanningRepository } from '../infrastructure/planning.repository';

export type LoanScheduleSource = {
  id: string;
  nextDueDate: Date;
  paidInstallments: number;
  installmentFreq: LoanInstallmentFrequency;
  totalInstallments: number;
  installmentAmount: { toString(): string } | number;
  originalAmount: { toString(): string } | number;
  currentBalance: { toString(): string } | number;
  interestRate: { toString(): string } | number | null;
  insuranceAmount: { toString(): string } | number | null;
};

/**
 * Rewrites the instalment rows of a loan from its parameters. Paid instalments
 * keep their original payment date and paid state; the rest are stored unpaid.
 */
@Injectable()
export class SyncLoanInstallmentsUseCase {
  constructor(private readonly repo: PlanningRepository) {}

  async execute(loan: LoanScheduleSource, now: Date): Promise<void> {
    // A fully paid loan still needs a schedule; anchoring past the last
    // instalment would be out of range.
    const anchorInstallmentNo = Math.min(
      loan.paidInstallments + 1,
      loan.totalInstallments,
    );
    const schedule = buildFrenchSchedule({
      anchorDueDate: loan.nextDueDate,
      anchorInstallmentNo,
      installmentFreq: loan.installmentFreq,
      totalInstallments: loan.totalInstallments,
      originalPrincipal: Number(loan.originalAmount),
      outstandingPrincipal: Number(loan.currentBalance),
      annualInterestRate:
        loan.interestRate === null ? null : Number(loan.interestRate),
      installmentAmount: Number(loan.installmentAmount),
      insuranceAmount:
        loan.insuranceAmount === null ? 0 : Number(loan.insuranceAmount),
    });

    const stored = await this.repo.listInstallments(loan.id);
    const storedPaidAt = new Map(
      stored.map((row) => [row.installmentNo, row.paidAt] as const),
    );
    const rows: LoanInstallmentPlan[] = schedule.map((entry) => {
      const paidAt =
        entry.installmentNo <= loan.paidInstallments
          ? (storedPaidAt.get(entry.installmentNo) ?? now)
          : null;
      const isPaid = paidAt !== null;
      return {
        ...entry,
        paidAt,
        status: isPaid ? 'PAID' : 'PENDING',
        paidAmount: isPaid ? entry.amount : 0,
        fees: 0,
        lateFee: 0,
      };
    });

    await this.repo.replaceLoanSchedule(loan.id, rows);
  }
}
