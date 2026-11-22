import type { RoutedSignal } from '@personal-os/contracts';
import type {
  ImportCardPaymentInput,
  ImportCardPaymentUseCase,
} from '../ledger/application/import-card-payment.use-case';
import type { FinTransactionStatusValue } from '../shared/domain/transaction-status';
import {
  buildConsumeResult,
  buildSignalImportMetadata,
  duplicatePlan,
  reviewPlan,
  type ImportPlan,
  type SignalConsumeResult,
} from './signal-import-plan';
import type { SignalCandidate, SignalPayload } from './signal-import-payload';
import type { SignalImportStore } from './signal-import-store';
import type {
  CardPaymentAccountCandidate,
  CardPaymentAccountResolution,
  CardPaymentCardResolution,
  CardPaymentTargets,
} from './signal-card-payment-targets';

type CardPaymentPlanInput = {
  signal: RoutedSignal;
  payload: SignalPayload;
  candidate: SignalCandidate;
  accounts: readonly CardPaymentAccountCandidate[];
  status: FinTransactionStatusValue;
  cardId?: string;
  sourceAccountId?: string;
};

/**
 * Pago de tarjeta confirmado: dos patas `CARD_PAYMENT`, sin gasto. Solo aplica
 * una vez; un pago manual parecido se vincula como duplicado y la duda va a
 * revisión.
 */
export class CardPaymentPlanner {
  constructor(
    private readonly cardPayments: ImportCardPaymentUseCase,
    private readonly targets: CardPaymentTargets,
    private readonly store: SignalImportStore,
  ) {}

  async build(input: CardPaymentPlanInput): Promise<ImportPlan> {
    if (input.status !== 'CONFIRMED') {
      return reviewPlan('CARD_PAYMENT_NOT_CONFIRMED');
    }
    const resolution = await this.resolveTargets(input);
    if (resolution.kind === 'review') {
      return resolution.plan;
    }
    const payment = this.buildPayment({
      ...input,
      cardId: resolution.card.cardId,
      sourceAccount: resolution.account,
    });
    const decision = await this.cardPayments.preview(
      input.signal.userId,
      payment,
    );
    if (decision.kind === 'duplicate') {
      return duplicatePlan(decision.transactionId);
    }
    if (decision.kind === 'conflict' || decision.kind === 'ambiguous') {
      return reviewPlan(decision.reason, {
        externalReference: input.candidate.bankReference ?? null,
        candidateTransactionIds: decision.candidateTransactionIds,
      });
    }
    return { kind: 'CARD_PAYMENT', payment };
  }

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

  private async resolveTargets(input: CardPaymentPlanInput): Promise<
    | {
        kind: 'resolved';
        card: CardPaymentCardResolution & { kind: 'resolved' };
        account: CardPaymentAccountResolution & { kind: 'resolved' };
      }
    | { kind: 'review'; plan: ImportPlan }
  > {
    const card = input.cardId
      ? await this.targets.resolveChosenCard({
          userId: input.signal.userId,
          cardId: input.cardId,
        })
      : await this.targets.resolveCard({
          userId: input.signal.userId,
          lastFour: input.candidate.last4 ?? null,
        });
    if (card.kind === 'review') {
      return { kind: 'review', plan: reviewPlan(card.reason) };
    }
    const account = input.sourceAccountId
      ? this.targets.resolveChosenAccount({
          accounts: input.accounts,
          accountId: input.sourceAccountId,
        })
      : this.targets.resolveAccount({
          accounts: input.accounts,
          accountNumberLast4: input.candidate.accountNumberLast4 ?? null,
        });
    if (account.kind === 'review') {
      return { kind: 'review', plan: reviewPlan(account.reason) };
    }
    if (!card.currencies.includes(input.candidate.currency!)) {
      return { kind: 'review', plan: reviewPlan('CARD_CURRENCY_MISSING') };
    }
    return { kind: 'resolved', card, account };
  }

  private buildPayment({
    signal,
    payload,
    candidate,
    cardId,
    sourceAccount,
  }: CardPaymentPlanInput & {
    cardId: string;
    sourceAccount: CardPaymentAccountResolution & { kind: 'resolved' };
  }): ImportCardPaymentInput {
    const amount = candidate.amount!;
    const currency = candidate.currency!;
    return {
      sourceAccountId: sourceAccount.accountId,
      sourceAccountCurrency: sourceAccount.currency,
      cardId,
      amount,
      currency,
      transactionDate: new Date(candidate.transactionDate!),
      externalReference: candidate.bankReference ?? null,
      importReference: signal.signalId,
      aiMetadata: buildSignalImportMetadata({
        signal,
        payload,
        candidate,
        movementClass: 'CARD_PAYMENT',
        amount,
        currency,
      }),
      description: candidate.merchant ?? 'Pago de tarjeta',
      notes: null,
      status: 'CONFIRMED',
    };
  }
}
