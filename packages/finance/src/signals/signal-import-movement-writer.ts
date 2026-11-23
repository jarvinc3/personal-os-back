import { Injectable } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
import { ImportFinancialTransactionUseCase } from '../ledger/application/import-financial-transaction.use-case';
import { LedgerQueryService } from '../ledger/application/ledger-query.service';
import {
  PartialReversalAlreadyAppliedError,
  PartialReversalAlreadyReversedError,
  PartialReversalExceedsOriginalError,
  PartialReversalNotApplicableError,
} from '../ledger/application/partial-reversal.errors';
import { REVERSAL_REVIEW_REASON } from '../ledger/application/resolve-reversal-target';
import {
  buildConsumeResult,
  type ImportDraft,
  type SignalConsumeResult,
} from './signal-import-plan';
import { SignalImportStore } from './signal-import-store';

/**
 * `DONE` ya tiene resultado; `WRITTEN` deja el movimiento creado y quien llama
 * completa el reintento de reversos y el emparejamiento de la pata.
 */
export type MovementWriteOutcome =
  | { kind: 'DONE'; consumeResult: SignalConsumeResult }
  | { kind: 'WRITTEN'; transactionId: string };

/** Writes the movement of an import plan and records its final state. */
@Injectable()
export class SignalImportMovementWriter {
  constructor(
    private readonly store: SignalImportStore,
    private readonly importTransaction: ImportFinancialTransactionUseCase,
    private readonly ledger: LedgerQueryService,
  ) {}

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
      await this.store.persist({
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

  private async writeMovement(
    signal: RoutedSignal,
    draft: ImportDraft,
  ): Promise<MovementWriteOutcome> {
    if (draft.cashAccountId) {
      const withdrawal = await this.importTransaction.executeAtmWithdrawal(
        signal.userId,
        { ...draft.input, cashAccountId: draft.cashAccountId },
      );
      if (!withdrawal?.debit?.id) {
        return {
          kind: 'DONE',
          consumeResult: await this.store.persistReview({
            signal,
            reason: 'ATM_WITHDRAWAL_NOT_IMPORTED',
          }),
        };
      }
      return { kind: 'WRITTEN', transactionId: withdrawal.debit.id };
    }
    const created = draft.transfer
      ? await this.importTransaction.executeUnpairedTransfer(
          signal.userId,
          draft.input,
        )
      : await this.importTransaction.execute(signal.userId, draft.input);
    return { kind: 'WRITTEN', transactionId: created.id };
  }

  private async duplicateOnUniqueViolation({
    signal,
    draft,
  }: {
    signal: RoutedSignal;
    draft: ImportDraft;
  }): Promise<MovementWriteOutcome | null> {
    const priorTransaction = await this.ledger.findTransactionByImportReference(
      signal.signalId,
      signal.userId,
    );
    if (priorTransaction) {
      await this.store.persist({
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
    const existing = await this.ledger.findTransactionByExternalReference(
      signal.userId,
      draft.input.externalReference,
    );
    if (!existing) {
      return null;
    }
    await this.store.persist({
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
      await this.store.persist({
        signal,
        status: 'DUPLICATE',
        transactionId: null,
        duplicateOfTransactionId: error.transactionId,
      });
      return buildConsumeResult('ALREADY_APPLIED', error.transactionId);
    }
    if (error instanceof PartialReversalAlreadyReversedError) {
      await this.store.persist({
        signal,
        status: 'REVERSED',
        transactionId: error.originalId,
      });
      return buildConsumeResult('ALREADY_APPLIED', error.originalId);
    }
    if (error instanceof PartialReversalExceedsOriginalError) {
      return this.store.persistReview({
        signal,
        reason: REVERSAL_REVIEW_REASON.EXCEEDS_ORIGINAL,
        evidence: { candidateTransactionIds: [error.originalId] },
      });
    }
    if (error instanceof PartialReversalNotApplicableError) {
      return this.store.persistReview({
        signal,
        reason: error.reason,
        evidence: { candidateTransactionIds: [error.originalId] },
      });
    }
    return null;
  }
}
