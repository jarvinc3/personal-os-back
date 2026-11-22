import { z } from 'zod';
import {
  MOVEMENT_CLASSES,
  type MovementClass,
} from '../ledger/domain/movement-class';
import { financeValidationReviewReasons } from './finance-review-reasons';
import {
  mapBankStatusToInternal,
  type FinTransactionStatusValue,
} from '../shared/domain/transaction-status';

const transactionSchema = z
  .object({
    kind: z.enum(['TRANSACTION', 'PENDING', 'NOT_TRANSACTION']).optional(),
    amount: z.number().positive().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    transactionDate: z.string().datetime().optional(),
    suggestedTransactionDate: z.string().datetime().optional(),
    suggestedTransactionDateSource: z.literal('EMAIL_HEADER').optional(),
    direction: z.enum(['DEBIT', 'CREDIT', 'TRANSFER']).optional(),
    merchant: z.string().trim().min(1).max(160).optional(),
    bankReference: z.string().trim().min(1).max(120).optional(),
    last4: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
    accountNumberLast4: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
    movementClass: z.enum(MOVEMENT_CLASSES).optional(),
    bankStatusNormalized: z
      .enum([
        'APPROVED',
        'COMPLETED',
        'POSTED',
        'PENDING',
        'IN_PROGRESS',
        'AUTHORIZED',
        'DECLINED',
        'REJECTED',
        'FAILED',
        'CANCELLED',
        'VOIDED',
        'REVERSED',
        'REFUNDED',
        'CHARGEBACK',
        'UNKNOWN',
      ])
      .optional(),
    statusConfidence: z.number().min(0).max(1).optional(),
    statusEvidence: z.string().trim().max(240).optional(),
    reverseOfBankReference: z.string().trim().min(1).max(120).optional(),
    reverseOfEmailMessageId: z.string().trim().min(1).max(512).optional(),
    receivedAmount: z.number().positive().optional(),
    transferExchangeRate: z.number().positive().optional(),
    categoryNameHint: z.string().trim().min(1).max(80).optional(),
  })
  .passthrough();

const payloadSchema = z
  .object({
    relevance: z.boolean().optional(),
    semanticType: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    transaction: transactionSchema.nullable().optional(),
    routes: z.array(z.string()).optional(),
  })
  .passthrough();

export const FINANCE_TRANSACTION_SIGNAL = 'FINANCE.TRANSACTION_DETECTED';

export type SignalCandidate = z.infer<typeof transactionSchema>;
export type SignalPayload = z.infer<typeof payloadSchema>;

export function parseSignalPayload(payload: unknown): SignalPayload | null {
  const parsed = payloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export function resolveMovementClass(
  candidate: SignalCandidate,
): MovementClass {
  if (candidate.movementClass) {
    return candidate.movementClass;
  }
  if (candidate.direction === 'CREDIT') {
    return 'INCOME';
  }
  return 'PURCHASE';
}

export function resolveTransactionType(
  candidate: SignalCandidate,
  movementClass: MovementClass,
): 'DEBIT' | 'CREDIT' {
  if (movementClass === 'TRANSFER_OUT' || movementClass === 'ATM_WITHDRAWAL') {
    return 'DEBIT';
  }
  if (movementClass === 'TRANSFER_IN') {
    return 'CREDIT';
  }
  return candidate.direction === 'CREDIT' ? 'CREDIT' : 'DEBIT';
}

export function firstValidationReviewReason(
  candidate: SignalCandidate,
): string | null {
  return financeValidationReviewReasons(candidate)[0] ?? null;
}

export function resolveImportStatus({
  payload,
  candidate,
}: {
  payload: SignalPayload;
  candidate: SignalCandidate;
}): FinTransactionStatusValue {
  if (candidate.kind === 'PENDING') {
    return 'PENDING';
  }
  return mapBankStatusToInternal({
    bankStatusNormalized: candidate.bankStatusNormalized ?? 'UNKNOWN',
    statusConfidence: candidate.statusConfidence ?? payload.confidence ?? 0,
  });
}

/**
 * La fecha elegida por una persona manda sobre la del correo y sobre la
 * sugerencia del encabezado, sin tocar el resto del candidato.
 */
export function withResolvedTransactionDate({
  candidate,
  transactionDate,
}: {
  candidate: SignalCandidate | null | undefined;
  transactionDate?: Date;
}): SignalCandidate | null | undefined {
  if (!candidate || !transactionDate) {
    return candidate;
  }
  return { ...candidate, transactionDate: transactionDate.toISOString() };
}
