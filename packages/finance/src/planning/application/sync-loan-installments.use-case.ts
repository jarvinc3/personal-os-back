import { Injectable } from '@nestjs/common';
import {
  buildLoanSchedule,
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
};

/**
 * Rewrites the instalment rows of a loan from its parameters. Paid instalments
 * keep their original payment date; the rest are stored unpaid.
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
    const schedule = buildLoanSchedule({
      anchorDueDate: loan.nextDueDate,
      anchorInstallmentNo,
      installmentFreq: loan.installmentFreq,
      totalInstallments: loan.totalInstallments,
      installmentAmount: Number(loan.installmentAmount),
    });

    const stored = await this.repo.listInstallments(loan.id);
    const storedPaidAt = new Map(
      stored.map((row) => [row.installmentNo, row.paidAt] as const),
    );
    const rows: LoanInstallmentPlan[] = schedule.map((entry) => ({
      ...entry,
      paidAt:
        entry.installmentNo <= loan.paidInstallments
          ? (storedPaidAt.get(entry.installmentNo) ?? now)
          : null,
    }));

    await this.repo.replaceLoanSchedule(loan.id, rows);
  }
}
