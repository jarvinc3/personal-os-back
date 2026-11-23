import { Injectable } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
import {
  ImportCardPaymentUseCase,
  type ImportCardPaymentInput,
} from '../ledger/application/import-card-payment.use-case';
import type { FinTransactionStatusValue } from '../shared/domain/transaction-status';
import {
  buildSignalImportMetadata,
  duplicatePlan,
  reviewPlan,
  type ImportPlan,
} from './signal-import-plan';
import type { SignalCandidate, SignalPayload } from './signal-import-payload';
import {
  CardPaymentTargets,
  type CardPaymentAccountCandidate,
  type CardPaymentAccountResolution,
  type CardPaymentCardResolution,
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
 * Pago de tarjeta confirmado: dos patas `CARD_PAYMENT`, sin gasto. Solo planifica
 * una vez; un pago manual parecido se vincula como duplicado y la duda va a
 * revisión.
 */
@Injectable()
export class CardPaymentPlanner {
  constructor(
    private readonly cardPayments: ImportCardPaymentUseCase,
    private readonly targets: CardPaymentTargets,
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
