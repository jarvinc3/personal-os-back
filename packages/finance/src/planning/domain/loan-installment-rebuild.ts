import { roundMoney } from '../../shared/domain/money';
import {
  loanPeriodsPerYear,
  type LoanInstallmentFrequency,
} from './loan-installment-schedule';

export type LoanRebuildInput = {
  originalAmount: number;
  installmentAmount: number;
  installmentFreq: LoanInstallmentFrequency;
  interestRate: number | null;
  insuranceAmount: number | null;
};

export type LoanRebuildInstallment = {
  id: string;
  installmentNo: number;
  paidAt: Date | null;
};

export type RebuiltInstallment = {
  id: string;
  installmentNo: number;
  principal: number;
  interest: number;
  insurance: number;
  amount: number;
  paidAt: Date | null;
};

/**
 * Rebuilds the French breakdown of every instalment from the original
 * principal. The migration left `principal = 0`, so the balance cannot come
 * from the stored rows. Pure and idempotent: the same input yields the same
 * breakdown on every run.
 */
export function rebuildLoanInstallments(
  loan: LoanRebuildInput,
  installments: readonly LoanRebuildInstallment[],
): RebuiltInstallment[] {
  const rate =
    loan.interestRate === null
      ? 0
      : loan.interestRate / loanPeriodsPerYear(loan.installmentFreq);
  const insurance = loan.insuranceAmount ?? 0;
  const ordered = [...installments].sort(
    (left, right) => left.installmentNo - right.installmentNo,
  );

  let balance = loan.originalAmount;
  return ordered.map((installment, index) => {
    const isLast = index === ordered.length - 1;
    const interest = roundMoney(Math.max(0, balance * rate));
    const principal = isLast
      ? roundMoney(balance)
      : roundMoney(
          Math.max(0, Math.min(loan.installmentAmount - interest, balance)),
        );
    balance = roundMoney(balance - principal);
    return {
      id: installment.id,
      installmentNo: installment.installmentNo,
      principal,
      interest,
      insurance,
      amount: roundMoney(principal + interest + insurance),
      paidAt: installment.paidAt,
    };
  });
}
