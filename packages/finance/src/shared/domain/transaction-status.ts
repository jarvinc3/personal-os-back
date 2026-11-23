export const FIN_TRANSACTION_TYPES = [
  'DEBIT',
  'CREDIT',
  'TRANSFER',
  'ADJUSTMENT',
  'CARD_PAYMENT',
] as const;

export type FinTransactionTypeValue = (typeof FIN_TRANSACTION_TYPES)[number];

/** Types a user can create manually; TRANSFER is created via the transfers endpoint. */
export const MANUAL_TRANSACTION_TYPES = ['DEBIT', 'CREDIT'] as const;

export const FIN_TRANSACTION_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'DECLINED',
  'REVERSED',
] as const;

export type FinTransactionStatusValue =
  (typeof FIN_TRANSACTION_STATUSES)[number];

/** Status of a movement already registered that has not hit the ledger yet. */
export const PENDING_TRANSACTION_STATUS = 'PENDING' as const;

export type BankStatusNormalized =
  | 'APPROVED'
  | 'COMPLETED'
  | 'POSTED'
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'AUTHORIZED'
  | 'DECLINED'
  | 'REJECTED'
  | 'FAILED'
  | 'CANCELLED'
  | 'VOIDED'
  | 'REVERSED'
  | 'REFUNDED'
  | 'CHARGEBACK'
  | 'UNKNOWN';

export const BANK_STATUS_CONFIDENCE_THRESHOLD = 0.7;

const INTERNAL_STATUS_BY_BANK_STATUS: Record<
  BankStatusNormalized,
  FinTransactionStatusValue
> = {
  APPROVED: 'CONFIRMED',
  COMPLETED: 'CONFIRMED',
  POSTED: 'CONFIRMED',
  PENDING: 'PENDING',
  IN_PROGRESS: 'PENDING',
  AUTHORIZED: 'PENDING',
  DECLINED: 'DECLINED',
  REJECTED: 'DECLINED',
  FAILED: 'DECLINED',
  CANCELLED: 'CANCELLED',
  VOIDED: 'CANCELLED',
  REVERSED: 'REVERSED',
  REFUNDED: 'REVERSED',
  CHARGEBACK: 'REVERSED',
  UNKNOWN: 'PENDING',
};

/** Whether the status applies ledger (balance + budget spent) when set on create. */
export function statusAffectsLedger(
  status: FinTransactionStatusValue,
): boolean {
  return status === 'CONFIRMED';
}

/**
 * Map AI bank status extraction to internal FinTransactionStatus.
 * Low confidence / UNKNOWN → PENDING (safe fallback).
 * REVERSED family returns REVERSED so the ingestion use case can compensate.
 */
export function mapBankStatusToInternal(params: {
  bankStatusNormalized: BankStatusNormalized;
  statusConfidence: number;
  confidenceThreshold?: number;
}): FinTransactionStatusValue {
  const threshold =
    params.confidenceThreshold ?? BANK_STATUS_CONFIDENCE_THRESHOLD;
  if (
    params.statusConfidence < threshold ||
    params.bankStatusNormalized === 'UNKNOWN'
  ) {
    return 'PENDING';
  }

  // A normalized status outside the contract keeps the same safe fallback.
  return (
    INTERNAL_STATUS_BY_BANK_STATUS[params.bankStatusNormalized] ?? 'PENDING'
  );
}
