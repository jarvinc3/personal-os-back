import { addDays } from 'date-fns';

export const LOAN_INSTALLMENT_FREQUENCIES = [
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
] as const;

export type LoanInstallmentFrequency =
  (typeof LOAN_INSTALLMENT_FREQUENCIES)[number];

export type ScheduledInstallment = {
  installmentNo: number;
  dueDate: Date;
  amount: number;
};

/** A scheduled instalment plus its payment state; null means unpaid. */
export type LoanInstallmentPlan = ScheduledInstallment & {
  paidAt: Date | null;
};

/** Shift by whole months, clamping the day to the target month's last day. */
function shiftClampedMonths(date: Date, offset: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(year, month + offset, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      Math.min(day, lastDay),
    ),
  );
}

/** Move a due date by a whole number of instalment periods. */
export function shiftLoanDueDate(
  dueDate: Date,
  frequency: LoanInstallmentFrequency,
  offset: number,
): Date {
  if (frequency === 'WEEKLY') {
    return addDays(dueDate, offset * 7);
  }
  if (frequency === 'BIWEEKLY') {
    return addDays(dueDate, offset * 14);
  }
  return shiftClampedMonths(dueDate, offset);
}

/**
 * Full schedule of a loan. `anchorInstallmentNo` is the instalment whose due
 * date is `anchorDueDate`: instalment 1 for a new loan, and the next unpaid
 * instalment once some are already paid.
 */
export function buildLoanSchedule(input: {
  anchorDueDate: Date;
  anchorInstallmentNo: number;
  installmentFreq: LoanInstallmentFrequency;
  totalInstallments: number;
  installmentAmount: number;
}): ScheduledInstallment[] {
  const {
    anchorDueDate,
    anchorInstallmentNo,
    installmentFreq,
    totalInstallments,
    installmentAmount,
  } = input;

  if (totalInstallments < 1) {
    throw new Error(
      `totalInstallments must be >= 1, received ${totalInstallments}`,
    );
  }
  if (anchorInstallmentNo < 1 || anchorInstallmentNo > totalInstallments) {
    throw new Error(
      `anchorInstallmentNo must be within 1..${totalInstallments}, received ${anchorInstallmentNo}`,
    );
  }

  const schedule: ScheduledInstallment[] = [];
  for (
    let installmentNo = 1;
    installmentNo <= totalInstallments;
    installmentNo += 1
  ) {
    schedule.push({
      installmentNo,
      dueDate: shiftLoanDueDate(
        anchorDueDate,
        installmentFreq,
        installmentNo - anchorInstallmentNo,
      ),
      amount: installmentAmount,
    });
  }
  return schedule;
}
