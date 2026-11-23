import { Injectable } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
import {
  ImportCardPaymentUseCase,
  type ImportCardPaymentInput,
} from '../ledger/application/import-card-payment.use-case';
import {
  buildConsumeResult,
  type SignalConsumeResult,
} from './signal-import-plan';
import { SignalImportStore } from './signal-import-store';

/** Applies a card-payment plan: writes both legs once and records the import. */
@Injectable()
export class SignalCardPaymentApplier {
  constructor(
    private readonly cardPayments: ImportCardPaymentUseCase,
    private readonly store: SignalImportStore,
  ) {}

  async apply(
    signal: RoutedSignal,
    payment: ImportCardPaymentInput,
  ): Promise<SignalConsumeResult> {
    const imported = await this.cardPayments.execute(signal.userId, payment);
    if (imported.kind === 'review') {
      return this.store.persistReview({
        signal,
        reason: imported.reason,
        evidence: {
          externalReference: payment.externalReference,
          candidateTransactionIds: imported.candidateTransactionIds,
        },
      });
    }
    if (imported.kind === 'duplicate') {
      await this.store.persist({
        signal,
        status: 'DUPLICATE',
        transactionId: null,
        duplicateOfTransactionId: imported.sourceTransactionId,
      });
      return buildConsumeResult(
        'ALREADY_APPLIED',
        imported.sourceTransactionId,
      );
    }
    if (imported.kind === 'not_written') {
      return this.store.persistReview({
        signal,
        reason: 'CARD_PAYMENT_NOT_IMPORTED',
      });
    }
    await this.store.persist({
      signal,
      status: 'IMPORTED',
      transactionId: imported.sourceTransactionId,
    });
    return buildConsumeResult('APPLIED', imported.sourceTransactionId);
  }
}
