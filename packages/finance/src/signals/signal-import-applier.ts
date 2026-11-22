import type { RoutedSignal } from '@personal-os/contracts';
import type { ImportFinancialTransactionUseCase } from '../ledger/application/import-financial-transaction.use-case';
import type { LedgerQueryService } from '../ledger/application/ledger-query.service';
import {
  PartialReversalAlreadyAppliedError,
  PartialReversalAlreadyReversedError,
  PartialReversalExceedsOriginalError,
  PartialReversalNotApplicableError,
} from '../ledger/application/partial-reversal.errors';
import { REVERSAL_REVIEW_REASON } from '../ledger/application/resolve-reversal-target';
import type { ReverseTransactionUseCase } from '../ledger/application/reverse-transaction.use-case';
import type { CardPaymentPlanner } from './signal-card-payment-planner';
import {
  buildConsumeResult,
  type ImportDraft,
  type ImportPlan,
  type SignalConsumeResult,
} from './signal-import-plan';
import type { SignalImportStore } from './signal-import-store';

/** Todo lo que el plan resuelve sin escribir un movimiento nuevo. */
export type StoredImportPlan = Exclude<ImportPlan, { kind: 'IMPORT' }>;

/**
 * `DONE` ya tiene resultado; `WRITTEN` deja el movimiento creado y quien llama
 * completa el reintento de reversos y el emparejamiento de la pata.
 */
export type MovementWriteOutcome =
  | { kind: 'DONE'; consumeResult: SignalConsumeResult }
  | { kind: 'WRITTEN'; transactionId: string };

/** Ejecuta el plan ya decidido: registra el estado y escribe donde toca. */
export class SignalImportApplier {
  constructor(
    private readonly deps: {
      store: SignalImportStore;
      importTransaction: ImportFinancialTransactionUseCase;
      reverseTransaction: ReverseTransactionUseCase;
      ledger: LedgerQueryService;
      cardPayments: CardPaymentPlanner;
    },
  ) {}

  async apply(
    signal: RoutedSignal,
    plan: StoredImportPlan,
  ): Promise<SignalConsumeResult> {
    switch (plan.kind) {
      case 'RETURN':
        return plan.consumeResult;
      case 'RECORD':
        await this.deps.store.persist({
          signal,
          status: plan.status,
          transactionId: plan.transactionId ?? null,
          reviewReason: plan.reason,
          duplicateOfTransactionId: plan.duplicateOfTransactionId,
          reviewEvidence: plan.evidence,
        });
        return plan.consumeResult;
      case 'REVERSE':
        return this.applyReversal(signal, plan.originalId, plan.metadata);
      case 'CARD_PAYMENT':
        return this.deps.cardPayments.apply(signal, plan.payment);
      default: {
        const unhandled: never = plan;
        throw new Error(`Unhandled import plan: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /**
   * Escribe el movimiento y deja el import en `IMPORTED`: la clave única de la
   * referencia decide el duplicado cuando dos corridas compiten.
   */
  async applyImport(
    signal: RoutedSignal,
    draft: ImportDraft,
  ): Promise<MovementWriteOutcome> {
    try {
      const written = await this.writeMovement(signal, draft);
      if (written.kind === 'DONE') {
        return written;
      }
      await this.deps.store.persist({
        signal,
        status: 'IMPORTED',
        transactionId: written.transactionId,
      });
      return written;
    } catch (error) {
      const partialReversalOutcome = await this.partialReversalFailureOutcome({
        signal,
        error,
      });
      if (partialReversalOutcome) {
        return { kind: 'DONE', consumeResult: partialReversalOutcome };
      }
      const code = (error as { code?: string }).code;
      if (code === 'P2002') {
        const duplicateWrite = await this.duplicateOnUniqueViolation({
          signal,
          draft,
        });
        if (duplicateWrite) {
          return duplicateWrite;
        }
      }
      throw error;
    }
  }

  private async applyReversal(
    signal: RoutedSignal,
    originalId: string,
    metadata: Record<string, unknown>,
  ): Promise<SignalConsumeResult> {
    await this.deps.reverseTransaction.execute(signal.userId, originalId, {
      ...metadata,
      reversalSignalId: signal.signalId,
      reversalSourceEmailMessageId: signal.sourceId,
    });
    await this.deps.store.persist({
      signal,
      status: 'REVERSED',
      transactionId: originalId,
    });
    return buildConsumeResult('APPLIED', originalId);
  }

  private async writeMovement(
    signal: RoutedSignal,
    draft: ImportDraft,
  ): Promise<MovementWriteOutcome> {
    if (draft.cashAccountId) {
      const withdrawal = await this.deps.importTransaction.executeAtmWithdrawal(
        signal.userId,
        { ...draft.input, cashAccountId: draft.cashAccountId },
      );
      if (!withdrawal?.debit?.id) {
        return {
          kind: 'DONE',
          consumeResult: await this.deps.store.persistReview({
            signal,
            reason: 'ATM_WITHDRAWAL_NOT_IMPORTED',
          }),
        };
      }
      return { kind: 'WRITTEN', transactionId: withdrawal.debit.id };
    }
    const created = draft.transfer
      ? await this.deps.importTransaction.executeUnpairedTransfer(
          signal.userId,
          draft.input,
        )
      : await this.deps.importTransaction.execute(signal.userId, draft.input);
    return { kind: 'WRITTEN', transactionId: created.id };
  }

  private async duplicateOnUniqueViolation({
    signal,
    draft,
  }: {
    signal: RoutedSignal;
    draft: ImportDraft;
  }): Promise<MovementWriteOutcome | null> {
    const priorTransaction =
      await this.deps.ledger.findTransactionByImportReference(
        signal.signalId,
        signal.userId,
      );
    if (priorTransaction) {
      await this.deps.store.persist({
        signal,
        status: 'IMPORTED',
        transactionId: priorTransaction.id,
      });
      return {
        kind: 'DONE',
        consumeResult: buildConsumeResult(
          'ALREADY_APPLIED',
          priorTransaction.id,
        ),
      };
    }
    if (!draft.input.externalReference) {
      return null;
    }
    const existing = await this.deps.ledger.findTransactionByExternalReference(
      signal.userId,
      draft.input.externalReference,
    );
    if (!existing) {
      return null;
    }
    await this.deps.store.persist({
      signal,
      status: 'DUPLICATE',
      transactionId: null,
      duplicateOfTransactionId: existing.id,
    });
    return {
      kind: 'DONE',
      consumeResult: buildConsumeResult('ALREADY_APPLIED', existing.id),
    };
  }

  private async partialReversalFailureOutcome({
    signal,
    error,
  }: {
    signal: RoutedSignal;
    error: unknown;
  }): Promise<SignalConsumeResult | null> {
    if (error instanceof PartialReversalAlreadyAppliedError) {
      await this.deps.store.persist({
        signal,
        status: 'DUPLICATE',
        transactionId: null,
        duplicateOfTransactionId: error.transactionId,
      });
      return buildConsumeResult('ALREADY_APPLIED', error.transactionId);
    }
    if (error instanceof PartialReversalAlreadyReversedError) {
      await this.deps.store.persist({
        signal,
        status: 'REVERSED',
        transactionId: error.originalId,
      });
      return buildConsumeResult('ALREADY_APPLIED', error.originalId);
    }
    if (error instanceof PartialReversalExceedsOriginalError) {
      return this.deps.store.persistReview({
        signal,
        reason: REVERSAL_REVIEW_REASON.EXCEEDS_ORIGINAL,
        evidence: { candidateTransactionIds: [error.originalId] },
      });
    }
    if (error instanceof PartialReversalNotApplicableError) {
      return this.deps.store.persistReview({
        signal,
        reason: error.reason,
        evidence: { candidateTransactionIds: [error.originalId] },
      });
    }
    return null;
  }
}
