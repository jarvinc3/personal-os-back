import type { RoutedSignal } from '@personal-os/contracts';
import type { LedgerQueryService } from '../ledger/application/ledger-query.service';
import {
  REVERSAL_CARD_ACCOUNT_WINDOW_DAYS,
  REVERSAL_REVIEW_REASON,
  type ReversalOriginal,
  type ReversalTargetDecision,
} from '../ledger/application/resolve-reversal-target';
import { toMoney } from '../shared/domain/money';
import { UNKNOWN_MERCHANT } from '../shared/domain/unknown-merchant';
import {
  buildConsumeResult,
  duplicatePlan,
  reviewPlan,
  type ImportPlan,
  type ImportReviewEvidence,
} from './signal-import-plan';
import type { SignalCandidate } from './signal-import-payload';
import type { ReversalTargetResolver } from './signal-reversal-target';

/** Plan de un aviso de reverso: original encontrado, repetido, parcial o en revisión. */
export class SignalReversalPlanner {
  constructor(
    private readonly ledger: LedgerQueryService,
    private readonly targets: ReversalTargetResolver,
  ) {}

  async build({
    signal,
    candidate,
    originalTransactionId,
  }: {
    signal: RoutedSignal;
    candidate: SignalCandidate;
    originalTransactionId?: string;
  }): Promise<ImportPlan> {
    const decision = await this.targets.resolve({
      userId: signal.userId,
      candidate,
      originalTransactionId,
    });
    if (decision.kind === 'review') {
      return reviewPlan(decision.reason, this.evidence(candidate, decision));
    }
    const original = decision.original;
    if (decision.kind === 'already_reversed') {
      return {
        kind: 'RECORD',
        status: 'REVERSED',
        transactionId: original.id,
        consumeResult: buildConsumeResult('ALREADY_APPLIED', original.id),
      };
    }
    const evidence = {
      ...this.evidence(candidate, decision),
      reversalOriginalId: original.id,
      ...(decision.step === 'CARD_ACCOUNT'
        ? {
            reversalCardId: original.cardId,
            reversalAccountId: original.accountId,
          }
        : {}),
    };
    const repeatedOrExcess = await this.repeatedOrExcess({
      signal,
      candidate,
      original,
      evidence,
    });
    if (repeatedOrExcess) {
      return repeatedOrExcess;
    }
    if (decision.kind === 'partial') {
      return this.partialPlan({ signal, candidate, original, evidence });
    }
    return {
      kind: 'REVERSE',
      originalId: original.id,
      metadata: { ...this.originalMetadata(original), ...evidence },
    };
  }

  /** A repeated refund is idempotent; one that exceeds the purchase needs a person. */
  private async repeatedOrExcess({
    signal,
    candidate,
    original,
    evidence,
  }: {
    signal: RoutedSignal;
    candidate: SignalCandidate;
    original: ReversalOriginal;
    evidence: ImportReviewEvidence;
  }): Promise<ImportPlan | null> {
    const repeatedRefund =
      await this.ledger.findImportedTransactionByEmailMessageId(
        signal.userId,
        signal.sourceId,
      );
    if (
      repeatedRefund &&
      repeatedRefund.type === 'CREDIT' &&
      repeatedRefund.linkedTransactionId === original.id
    ) {
      return duplicatePlan(repeatedRefund.id, evidence);
    }
    const priorRefundTotal = await this.ledger.findLinkedRefundTotal({
      userId: signal.userId,
      originalId: original.id,
      currency: original.currency,
    });
    if (
      toMoney(priorRefundTotal)
        .plus(toMoney(candidate.amount!))
        .greaterThan(toMoney(original.amount))
    ) {
      return reviewPlan(REVERSAL_REVIEW_REASON.EXCEEDS_ORIGINAL, {
        ...evidence,
        candidateTransactionIds: [original.id],
      });
    }
    return null;
  }

  private partialPlan({
    signal,
    candidate,
    original,
    evidence,
  }: {
    signal: RoutedSignal;
    candidate: SignalCandidate;
    original: ReversalOriginal;
    evidence: ImportReviewEvidence;
  }): ImportPlan {
    const merchantMissing = !candidate.merchant;
    return {
      kind: 'IMPORT',
      draft: {
        cashAccountId: null,
        transfer: false,
        input: {
          accountId: original.accountId ?? undefined,
          cardId: original.cardId ?? undefined,
          importReference: signal.signalId,
          externalReference: candidate.bankReference ?? null,
          amount: candidate.amount!,
          currency: candidate.currency!,
          merchant: candidate.merchant ?? UNKNOWN_MERCHANT,
          merchantIsPlaceholder: merchantMissing,
          description: 'Reverso parcial',
          transactionDate: new Date(candidate.transactionDate!),
          type: 'CREDIT',
          status: 'CONFIRMED',
          categoryId: original.categoryId ?? undefined,
          linkedTransactionId: original.id,
          sourceEmailMessageId: signal.sourceId,
          aiMetadata: {
            ...evidence,
            reversalSignalId: signal.signalId,
            reversalSourceEmailMessageId: signal.sourceId,
            merchantMissing,
          },
        },
      },
    };
  }

  private evidence(
    candidate: SignalCandidate,
    decision: ReversalTargetDecision,
  ): ImportReviewEvidence {
    return {
      reversalReference: candidate.reverseOfBankReference ?? null,
      reverseOfEmailMessageId: candidate.reverseOfEmailMessageId ?? null,
      reversalStep: decision.step,
      reversalAmount: candidate.amount ?? null,
      ...(decision.step === 'CARD_ACCOUNT'
        ? { reversalWindowDays: REVERSAL_CARD_ACCOUNT_WINDOW_DAYS }
        : {}),
      candidateTransactionIds:
        decision.kind === 'review' && decision.candidateIds.length > 0
          ? decision.candidateIds
          : null,
    };
  }

  private originalMetadata(
    original: ReversalOriginal,
  ): Record<string, unknown> {
    return original.aiMetadata &&
      typeof original.aiMetadata === 'object' &&
      !Array.isArray(original.aiMetadata)
      ? (original.aiMetadata as Record<string, unknown>)
      : {};
  }
}
