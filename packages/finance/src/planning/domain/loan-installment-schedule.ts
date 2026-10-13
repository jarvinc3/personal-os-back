import { addDays } from 'date-fns';
import { roundMoney } from '../../shared/domain/money';

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

/** A scheduled instalment with its French breakdown. */
export type FrenchInstallment = ScheduledInstallment & {
  principal: number;
  interest: number;
  insurance: number;
};

/** Payment periods in a year for the loan frequency. */
export function loanPeriodsPerYear(
  frequency: LoanInstallmentFrequency,
): number {
  if (frequency === 'WEEKLY') {
    return 52;
  }
  if (frequency === 'BIWEEKLY') {
    return 26;
  }
  return 12;
}

/** French payment for a principal over a number of periods. */
export function frenchInstallmentAmount(input: {
  principal: number;
  annualInterestRate: number | null;
  installmentFreq: LoanInstallmentFrequency;
  totalInstallments: number;
}): number {
  const rate =
    input.annualInterestRate === null
      ? 0
      : input.annualInterestRate / loanPeriodsPerYear(input.installmentFreq);
  if (rate === 0 || input.totalInstallments < 1) {
    return roundMoney(input.principal / Math.max(input.totalInstallments, 1));
  }
  const factor = 1 - Math.pow(1 + rate, -input.totalInstallments);
  return roundMoney((input.principal * rate) / factor);
}

/**
 * How many periods are left when paying a balance with a fixed instalment.
 */
export function remainingInstallmentsFor(input: {
  balance: number;
  installmentAmount: number;
  annualInterestRate: number | null;
  installmentFreq: LoanInstallmentFrequency;
}): number {
  if (input.installmentAmount <= 0 || input.balance <= 0) {
    return 1;
  }
  const rate =
    input.annualInterestRate === null
      ? 0
      : input.annualInterestRate / loanPeriodsPerYear(input.installmentFreq);
  if (rate === 0) {
    return Math.max(1, Math.ceil(input.balance / input.installmentAmount));
  }
  const ratio = 1 - (input.balance * rate) / input.installmentAmount;
  if (ratio <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(-Math.log(ratio) / Math.log(1 + rate)));
}

/**
 * French schedule for the whole loan. Instalments before the anchor are
 * simulated from the original principal; from the anchor on, the projection
 * starts from `outstandingPrincipal` (which already reflects prepayments). The
 * loan's stored `installmentAmount` is the principal-plus-interest payment;
 * insurance is added on top, and the last instalment clears what is left.
 */
export function buildFrenchSchedule(input: {
  anchorDueDate: Date;
  anchorInstallmentNo: number;
  installmentFreq: LoanInstallmentFrequency;
  totalInstallments: number;
  originalPrincipal: number;
  outstandingPrincipal: number;
  annualInterestRate: number | null;
  installmentAmount: number;
  insuranceAmount: number;
}): FrenchInstallment[] {
  if (
    input.anchorInstallmentNo < 1 ||
    input.anchorInstallmentNo > input.totalInstallments
  ) {
    throw new Error(
      `anchorInstallmentNo must be within 1..${input.totalInstallments}, received ${input.anchorInstallmentNo}`,
    );
  }
  const rate =
    input.annualInterestRate === null
      ? 0
      : input.annualInterestRate / loanPeriodsPerYear(input.installmentFreq);

  const schedule: FrenchInstallment[] = [];
  let balance = input.originalPrincipal;
  for (
    let installmentNo = 1;
    installmentNo <= input.totalInstallments;
    installmentNo += 1
  ) {
    if (
      installmentNo === input.anchorInstallmentNo &&
      input.outstandingPrincipal > 0
    ) {
      balance = input.outstandingPrincipal;
    }
    const isLast = installmentNo === input.totalInstallments;
    const interest = roundMoney(Math.max(0, balance * rate));
    const principal = isLast
      ? roundMoney(balance)
      : roundMoney(
          Math.max(0, Math.min(input.installmentAmount - interest, balance)),
        );
    balance = roundMoney(balance - principal);
    schedule.push({
      installmentNo,
      dueDate: shiftLoanDueDate(
        input.anchorDueDate,
        input.installmentFreq,
        installmentNo - input.anchorInstallmentNo,
      ),
      principal,
      interest,
      insurance: input.insuranceAmount,
      amount: roundMoney(principal + interest + input.insuranceAmount),
    });
  }
  return schedule;
}

/** A scheduled instalment plus its payment state; null means unpaid. */
export type LoanInstallmentPlan = FrenchInstallment & {
  paidAt: Date | null;
  status: LoanInstallmentStatusValue;
  paidAmount: number;
  fees: number;
  lateFee: number;
};

export type LoanInstallmentStatusValue =
  'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE';

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
