import { Injectable } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
import { PrismaService, type Prisma } from '@personal-os/database';
import { REVERSAL_REVIEW_REASON } from '../ledger/application/resolve-reversal-target';
import { TRANSFER_REVIEW_REASON } from '../ledger/application/resolve-transfer-import';
import { CARD_PAYMENT_REVIEW_REASON } from './signal-card-payment-targets';
import type {
  ImportReviewEvidence,
  ImportStatus,
  SignalConsumeResult,
} from './signal-import-plan';

const PENDING_REVERSAL_RETRY_LIMIT = 20;

/**
 * Motivos que dependen de encontrar la cuenta o la tarjeta del movimiento. Un
 * producto creado después puede resolverlos, así que se vuelven a calcular.
 */
const RETRYABLE_TARGET_REVIEW_REASONS: ReadonlySet<string> = new Set([
  'NO_LEDGER_TARGET',
  'AMBIGUOUS_LEDGER_TARGET',
  TRANSFER_REVIEW_REASON.ACCOUNT_NOT_FOUND,
  TRANSFER_REVIEW_REASON.ACCOUNT_AMBIGUOUS,
  CARD_PAYMENT_REVIEW_REASON.CARD_NOT_FOUND,
  CARD_PAYMENT_REVIEW_REASON.CARD_AMBIGUOUS,
  CARD_PAYMENT_REVIEW_REASON.SOURCE_ACCOUNT_NOT_FOUND,
  CARD_PAYMENT_REVIEW_REASON.SOURCE_ACCOUNT_AMBIGUOUS,
]);

const PENDING_REVERSAL_REASONS = [
  REVERSAL_REVIEW_REASON.ORIGINAL_NOT_FOUND,
  REVERSAL_REVIEW_REASON.REFERENCE_NOT_FOUND,
  REVERSAL_REVIEW_REASON.COMMERCE_MISSING,
];

export type PriorSignalImport = {
  status: ImportStatus;
  reviewReason: string | null;
  transactionId: string | null;
  duplicateOfTransactionId: string | null;
};

export type PendingReversalRow = {
  signalId: string;
  sourceEmailMessageId: string;
  createdAt: Date;
  candidate: Prisma.JsonValue;
};

export function isRetryableTargetReview(prior: {
  status: string;
  reviewReason: string | null;
}): boolean {
  if (prior.status !== 'REVIEW_REQUIRED') {
    return false;
  }
  return (
    prior.reviewReason !== null &&
    RETRYABLE_TARGET_REVIEW_REASONS.has(prior.reviewReason)
  );
}

@Injectable()
export class SignalImportStore {
  constructor(private readonly prisma: PrismaService) {}

  async findPriorImport({
    userId,
    signalId,
  }: {
    userId: string;
    signalId: string;
  }): Promise<PriorSignalImport | null> {
    return this.prisma.finSignalImport.findUnique({
      where: { userId_signalId: { userId, signalId } },
    });
  }

  /** Una revisión por destino se puede reaplicar cuando aparece el producto. */
  async findRetryableReviewPending({
    userId,
    signalId,
  }: {
    userId: string;
    signalId: string;
  }): Promise<boolean> {
    const prior = await this.prisma.finSignalImport.findUnique({
      where: { userId_signalId: { userId, signalId } },
      select: { status: true, reviewReason: true },
    });
    return prior !== null && isRetryableTargetReview(prior);
  }

  async persist({
    signal,
    status,
    transactionId,
    reviewReason,
    duplicateOfTransactionId,
    reviewEvidence,
  }: {
    signal: RoutedSignal;
    status: ImportStatus;
    transactionId: string | null;
    reviewReason?: string;
    duplicateOfTransactionId?: string | null;
    reviewEvidence?: ImportReviewEvidence;
  }): Promise<void> {
    await this.prisma.finSignalImport.upsert({
      where: {
        userId_signalId: { userId: signal.userId, signalId: signal.signalId },
      },
      create: {
        userId: signal.userId,
        signalId: signal.signalId,
        sourceEmailMessageId: signal.sourceId,
        status,
        reviewReason,
        transactionId,
        duplicateOfTransactionId,
        candidate: reviewEvidence
          ? { ...signal.payload, financeImportEvidence: reviewEvidence }
          : signal.payload,
      },
      update: {
        status,
        reviewReason,
        transactionId,
        duplicateOfTransactionId,
      },
    });
  }

  async persistReview({
    signal,
    reason,
    evidence,
  }: {
    signal: RoutedSignal;
    reason: string;
    evidence?: ImportReviewEvidence;
  }): Promise<SignalConsumeResult> {
    await this.persist({
      signal,
      status: 'REVIEW_REQUIRED',
      transactionId: null,
      reviewReason: reason,
      reviewEvidence: evidence,
    });
    return { outcome: 'REVIEW_REQUIRED', domainReferences: [], reason };
  }

  async findPendingReversalRows(userId: string): Promise<PendingReversalRow[]> {
    return this.prisma.finSignalImport.findMany({
      where: {
        userId,
        status: 'REVIEW_REQUIRED',
        reviewReason: { in: PENDING_REVERSAL_REASONS },
      },
      select: {
        signalId: true,
        sourceEmailMessageId: true,
        createdAt: true,
        candidate: true,
      },
      orderBy: { updatedAt: 'asc' },
      take: PENDING_REVERSAL_RETRY_LIMIT,
    });
  }

  async findStatus({
    userId,
    signalId,
  }: {
    userId: string;
    signalId: string;
  }): Promise<ImportStatus | null> {
    const current = await this.prisma.finSignalImport.findFirst({
      where: { userId, signalId },
      select: { status: true },
    });
    return current?.status ?? null;
  }
}
