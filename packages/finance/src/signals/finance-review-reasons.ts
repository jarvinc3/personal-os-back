const TARGET_REVIEW_CODES = [
  'AMBIGUOUS_LEDGER_TARGET',
  'NO_LEDGER_TARGET',
  'TRANSFER_',
  'CARD_PAYMENT_',
  'CARD_CURRENCY_',
  'ATM_',
];

type CandidateValidationInput = {
  kind?: string;
  amount?: number | null;
  currency?: string | null;
  transactionDate?: string | null;
  suggestedTransactionDate?: string | null;
  suggestedTransactionDateSource?: string | null;
  direction?: string | null;
  movementClass?: string | null;
};

export function financeValidationReviewReasons(
  candidate: CandidateValidationInput,
): string[] {
  const reasons: string[] = [];
  if (candidate.kind === 'NOT_TRANSACTION') {
    reasons.push('NOT_A_TRANSACTION');
  }
  if (candidate.amount == null) {
    reasons.push('AMOUNT_MISSING');
  }
  if (!candidate.currency) {
    reasons.push('CURRENCY_MISSING');
  }
  if (!candidate.transactionDate) {
    if (
      candidate.suggestedTransactionDate &&
      candidate.suggestedTransactionDateSource === 'EMAIL_HEADER' &&
      !Number.isNaN(Date.parse(candidate.suggestedTransactionDate))
    ) {
      reasons.push('TRANSACTION_DATE_SUGGESTED');
    } else {
      reasons.push('TRANSACTION_DATE_MISSING');
    }
  } else if (Number.isNaN(Date.parse(candidate.transactionDate))) {
    reasons.push('TRANSACTION_DATE_MISSING');
  }
  if (
    !candidate.direction ||
    (candidate.direction === 'TRANSFER' &&
      candidate.movementClass !== 'TRANSFER_OUT' &&
      candidate.movementClass !== 'TRANSFER_IN')
  ) {
    reasons.push('DIRECTION_MISSING');
  }
  return reasons;
}

function severity(code: string): number {
  if (
    code.startsWith('REVERSAL_') ||
    code === 'LOW_CONFIDENCE_OR_NOT_FINANCE'
  ) {
    return 0;
  }
  if (TARGET_REVIEW_CODES.some((prefix) => code.startsWith(prefix))) {
    return 1;
  }
  if (
    code === 'AMOUNT_MISSING' ||
    code === 'CURRENCY_MISSING' ||
    code.startsWith('TRANSACTION_DATE_') ||
    code === 'DIRECTION_MISSING'
  ) {
    return 2;
  }
  return 3;
}

/** Stable severity order for the additive Finance preview contract. */
export function orderFinanceReviewReasons(
  reasons: readonly string[],
): string[] {
  return [...new Set(reasons)].sort(
    (left, right) =>
      severity(left) - severity(right) ||
      (left < right ? -1 : left > right ? 1 : 0),
  );
}
