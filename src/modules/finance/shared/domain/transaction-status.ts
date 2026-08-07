export type FinTransactionStatusValue =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'DECLINED'
  | 'REVERSED';

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

/** Whether the status applies ledger (balance + budget spent) when set on create. */
export function statusAffectsLedger(status: FinTransactionStatusValue): boolean {
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
  const threshold = params.confidenceThreshold ?? BANK_STATUS_CONFIDENCE_THRESHOLD;
  if (
    params.statusConfidence < threshold ||
    params.bankStatusNormalized === 'UNKNOWN'
  ) {
    return 'PENDING';
  }

  switch (params.bankStatusNormalized) {
    case 'APPROVED':
    case 'COMPLETED':
    case 'POSTED':
      return 'CONFIRMED';
    case 'PENDING':
    case 'IN_PROGRESS':
    case 'AUTHORIZED':
      return 'PENDING';
    case 'DECLINED':
    case 'REJECTED':
    case 'FAILED':
      return 'DECLINED';
    case 'CANCELLED':
    case 'VOIDED':
      return 'CANCELLED';
    case 'REVERSED':
    case 'REFUNDED':
    case 'CHARGEBACK':
      return 'REVERSED';
    default:
      return 'PENDING';
  }
}
