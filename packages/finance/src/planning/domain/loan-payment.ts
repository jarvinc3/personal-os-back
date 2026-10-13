import { roundMoney } from '../../shared/domain/money';

export const LOAN_PREPAYMENT_MODE = {
  REDUCE_TERM: 'REDUCE_TERM',
  REDUCE_INSTALLMENT: 'REDUCE_INSTALLMENT',
} as const;

export type LoanPrepaymentMode =
  (typeof LOAN_PREPAYMENT_MODE)[keyof typeof LOAN_PREPAYMENT_MODE];

export type LoanPaymentBreakdown = {
  lateFee: number;
  fees: number;
  insurance: number;
  interest: number;
  principal: number;
  applied: number;
};

/**
 * Splits a payment over one instalment in the bank order:
 * late fee, fees, insurance, interest, then principal.
 */
export function distributeLoanPayment(input: {
  paid: number;
  lateFee: number;
  fees: number;
  insurance: number;
  interest: number;
  principal: number;
}): LoanPaymentBreakdown {
  let left = Math.max(0, input.paid);
  const take = (wanted: number): number => {
    const taken = Math.min(left, Math.max(0, wanted));
    left = roundMoney(left - taken);
    return roundMoney(taken);
  };

  const lateFee = take(input.lateFee);
  const fees = take(input.fees);
  const insurance = take(input.insurance);
  const interest = take(input.interest);
  const principal = take(input.principal);
  return {
    lateFee,
    fees,
    insurance,
    interest,
    principal,
    applied: roundMoney(input.paid - left),
  };
}

export function installmentDueTotal(installment: {
  principal: number;
  interest: number;
  insurance: number;
  fees: number;
  lateFee: number;
}): number {
  return roundMoney(
    installment.principal +
      installment.interest +
      installment.insurance +
      installment.fees +
      installment.lateFee,
  );
}
