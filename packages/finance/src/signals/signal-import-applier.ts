import { Injectable } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
import { ReverseTransactionUseCase } from '../ledger/application/reverse-transaction.use-case';
import { SignalCardPaymentApplier } from './signal-card-payment-applier';
import {
  buildConsumeResult,
  type ImportPlan,
  type SignalConsumeResult,
} from './signal-import-plan';
import { SignalImportStore } from './signal-import-store';

/** Todo lo que el plan resuelve sin escribir un movimiento nuevo. */
export type StoredImportPlan = Exclude<ImportPlan, { kind: 'IMPORT' }>;

/** Applies the plans that do not write a movement: state, reversal or card. */
@Injectable()
export class SignalImportApplier {
  constructor(
    private readonly store: SignalImportStore,
    private readonly reverseTransaction: ReverseTransactionUseCase,
    private readonly cardPayments: SignalCardPaymentApplier,
  ) {}

  async apply(
    signal: RoutedSignal,
    plan: StoredImportPlan,
  ): Promise<SignalConsumeResult> {
    switch (plan.kind) {
      case 'RETURN':
        return plan.consumeResult;
      case 'RECORD':
        await this.store.persist({
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
        return this.cardPayments.apply(signal, plan.payment);
      default: {
        const unhandled: never = plan;
        throw new Error(`Unhandled import plan: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private async applyReversal(
    signal: RoutedSignal,
    originalId: string,
    metadata: Record<string, unknown>,
  ): Promise<SignalConsumeResult> {
    await this.reverseTransaction.execute(signal.userId, originalId, {
      ...metadata,
      reversalSignalId: signal.signalId,
      reversalSourceEmailMessageId: signal.sourceId,
    });
    await this.store.persist({
      signal,
      status: 'REVERSED',
      transactionId: originalId,
    });
    return buildConsumeResult('APPLIED', originalId);
  }
}
