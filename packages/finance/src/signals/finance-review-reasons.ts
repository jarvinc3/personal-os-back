const TARGET_REVIEW_CODES = [
  'AMBIGUOUS_LEDGER_TARGET',
  'NO_LEDGER_TARGET',
  'TRANSFER_',
  'CARD_PAYMENT_',
  'CARD_CURRENCY_',
  'ATM_',
];

const TRANSACTION_DATE_REASON = {
  SUGGESTED: 'TRANSACTION_DATE_SUGGESTED',
  MISSING: 'TRANSACTION_DATE_MISSING',
} as const;

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
  const dateReason = transactionDateReason(candidate);
  if (dateReason) {
    reasons.push(dateReason);
  }
  if (directionMissing(candidate)) {
    reasons.push('DIRECTION_MISSING');
  }
  return reasons;
}

function transactionDateReason(
  candidate: CandidateValidationInput,
): string | null {
  if (!candidate.transactionDate) {
    return hasEmailHeaderDate(candidate)
      ? TRANSACTION_DATE_REASON.SUGGESTED
      : TRANSACTION_DATE_REASON.MISSING;
  }
  return Number.isNaN(Date.parse(candidate.transactionDate))
    ? TRANSACTION_DATE_REASON.MISSING
    : null;
}

function hasEmailHeaderDate(candidate: CandidateValidationInput): boolean {
  if (!candidate.suggestedTransactionDate) {
    return false;
  }
  if (candidate.suggestedTransactionDateSource !== 'EMAIL_HEADER') {
    return false;
  }
  return !Number.isNaN(Date.parse(candidate.suggestedTransactionDate));
}

function directionMissing(candidate: CandidateValidationInput): boolean {
  if (!candidate.direction) {
    return true;
  }
  return (
    candidate.direction === 'TRANSFER' &&
    candidate.movementClass !== 'TRANSFER_OUT' &&
    candidate.movementClass !== 'TRANSFER_IN'
  );
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

function compareCodes(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/** Stable severity order for the additive Finance preview contract. */
export function orderFinanceReviewReasons(
  reasons: readonly string[],
): string[] {
  return [...new Set(reasons)].sort(
    (left, right) =>
      severity(left) - severity(right) || compareCodes(left, right),
  );
}
