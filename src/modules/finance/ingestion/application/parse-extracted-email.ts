import type { ExtractedEmailTransaction } from './ports/email-transaction-extractor.port';
import {
  EMAIL_MOVEMENT_CLASSES,
  classifyMovementFromText,
  type EmailMovementClass,
} from './email-movement';

function asMovementClass(value: unknown): EmailMovementClass | null {
  return typeof value === 'string' &&
    (EMAIL_MOVEMENT_CLASSES as readonly string[]).includes(value)
    ? (value as EmailMovementClass)
    : null;
}

export function parseExtractedPayload(
  payload: unknown,
): ExtractedEmailTransaction | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const row = payload as Partial<ExtractedEmailTransaction> & {
    amount?: number | null;
  };
  if (
    typeof row.currency !== 'string' ||
    typeof row.transactionDate !== 'string' ||
    typeof row.description !== 'string' ||
    (row.type !== 'DEBIT' && row.type !== 'CREDIT')
  ) {
    return null;
  }
  const amount =
    typeof row.amount === 'number' && row.amount > 0 ? row.amount : null;
  const movementClass = classifyMovementFromText({
    description: row.description,
    merchant: typeof row.merchant === 'string' ? row.merchant : null,
    notes: typeof row.notes === 'string' ? row.notes : null,
    type: row.type,
    movementClass: asMovementClass(row.movementClass),
  });
  return {
    amount,
    currency: row.currency,
    type: row.type,
    transactionDate: row.transactionDate,
    merchant: typeof row.merchant === 'string' ? row.merchant : null,
    description: row.description,
    notes:
      typeof row.notes === 'string' && row.notes.trim()
        ? row.notes.trim()
        : null,
    movementClass,
    categoryNameHint:
      typeof row.categoryNameHint === 'string' ? row.categoryNameHint : null,
    bankStatusRaw:
      typeof row.bankStatusRaw === 'string' ? row.bankStatusRaw : null,
    bankStatusNormalized: row.bankStatusNormalized ?? 'UNKNOWN',
    statusEvidence:
      typeof row.statusEvidence === 'string' ? row.statusEvidence : 'unknown',
    statusConfidence:
      typeof row.statusConfidence === 'number' ? row.statusConfidence : 0.5,
    bankReference:
      typeof row.bankReference === 'string' ? row.bankReference : null,
    reverseOfEmailMessageId:
      typeof row.reverseOfEmailMessageId === 'string'
        ? row.reverseOfEmailMessageId
        : null,
    reverseOriginalRef:
      typeof row.reverseOriginalRef === 'string'
        ? row.reverseOriginalRef
        : null,
    instrumentHint:
      row.instrumentHint === 'ACCOUNT' || row.instrumentHint === 'CARD'
        ? row.instrumentHint
        : null,
    lastFourHint:
      typeof row.lastFourHint === 'string' ? row.lastFourHint : null,
    accountNumberHint:
      typeof row.accountNumberHint === 'string' ? row.accountNumberHint : null,
  };
}
