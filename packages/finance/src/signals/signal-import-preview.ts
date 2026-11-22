import type { RoutedSignal, SignalImportPreview } from '@personal-os/contracts';
import type { ImportFinancialMovementInput } from '../ledger/application/import-financial-transaction.use-case';
import {
  isAtmMovementClass,
  isCardPaymentMovementClass,
  isTransferMovementClass,
  type MovementClass,
} from '../ledger/domain/movement-class';
import {
  financeValidationReviewReasons,
  orderFinanceReviewReasons,
} from './finance-review-reasons';
import type { ImportPlan } from './signal-import-plan';
import {
  parseSignalPayload,
  resolveImportStatus,
  resolveMovementClass,
  type SignalCandidate,
} from './signal-import-payload';
import type { SignalImportTargets } from './signal-import-targets';
import type { CardPaymentTargets } from './signal-card-payment-targets';
import type { SignalReversalPlanner } from './signal-reversal-planner';

const REVERSAL_WOULD_APPLY = 'REVERSAL_WOULD_APPLY';

/**
 * Vista previa de la importación: describe lo que el plan escribiría y reúne
 * todos los motivos de revisión que la corrida todavía no usó para decidir.
 */
export class SignalImportPreviewReader {
  constructor(
    private readonly targets: SignalImportTargets,
    private readonly cardPaymentTargets: CardPaymentTargets,
    private readonly reversalPlanner: SignalReversalPlanner,
  ) {}

  async describe({
    signal,
    plan,
  }: {
    signal: RoutedSignal;
    plan: ImportPlan;
  }): Promise<SignalImportPreview> {
    const preview = this.describePlan(plan);
    if (preview.outcome !== 'REVIEW_REQUIRED') {
      return preview;
    }
    const reviewReasons = await this.collectReviewReasons({
      signal,
      primaryReason: preview.reason,
    });
    return {
      ...preview,
      reason: reviewReasons[0] ?? preview.reason,
      reviewReasons,
    };
  }

  private describePlan(plan: ImportPlan): SignalImportPreview {
    switch (plan.kind) {
      case 'RETURN':
      case 'RECORD':
        return {
          outcome: plan.consumeResult.outcome,
          reason: plan.consumeResult.reason,
          domainReferences: plan.consumeResult.domainReferences,
        };
      case 'REVERSE':
        return {
          outcome: 'APPLIED',
          reason: REVERSAL_WOULD_APPLY,
          domainReferences: [{ type: 'FinTransaction', id: plan.originalId }],
        };
      case 'CARD_PAYMENT':
        return {
          outcome: 'APPLIED',
          cardPayment: {
            sourceAccountId: plan.payment.sourceAccountId,
            cardId: plan.payment.cardId,
            amount: plan.payment.amount,
            currency: plan.payment.currency,
            status: plan.payment.status,
            transactionDate: plan.payment.transactionDate.toISOString(),
            description: plan.payment.description,
            externalReference: plan.payment.externalReference,
            importReference: plan.payment.importReference,
          },
        };
      case 'IMPORT':
        return {
          outcome: 'APPLIED',
          movement: this.movementPreview(plan.draft.input),
        };
      default: {
        const unhandled: never = plan;
        throw new Error(`Unhandled import plan: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private movementPreview(
    input: ImportFinancialMovementInput,
  ): NonNullable<SignalImportPreview['movement']> {
    return {
      accountId: input.accountId ?? null,
      cardId: input.cardId ?? null,
      amount: input.amount,
      currency: input.currency,
      type: input.type ?? 'DEBIT',
      status: input.status,
      transactionDate: input.transactionDate.toISOString(),
      description: input.description,
      categoryId: input.categoryId ?? null,
      legRole: input.legRole ?? null,
      externalReference: input.externalReference ?? null,
      importReference: input.importReference,
    };
  }

  /** Reads independent blockers without changing the execution decision. */
  private async collectReviewReasons({
    signal,
    primaryReason,
  }: {
    signal: RoutedSignal;
    primaryReason?: string;
  }): Promise<string[]> {
    const reasons = primaryReason ? [primaryReason] : ['REVIEW_REQUIRED'];
    const payload = parseSignalPayload(signal.payload);
    const candidate = payload?.transaction ?? null;
    if (!payload || !candidate || candidate.kind === 'NOT_TRANSACTION') {
      return orderFinanceReviewReasons(reasons);
    }
    reasons.push(...financeValidationReviewReasons(candidate));

    const movementClass = resolveMovementClass(candidate);
    const status = resolveImportStatus({ payload, candidate });
    if (status === 'REVERSED') {
      reasons.push(...(await this.reversalReasons({ signal, candidate })));
      return orderFinanceReviewReasons(reasons);
    }
    reasons.push(...transferDirectionReasons({ candidate, movementClass }));

    const accounts = await this.targets.findActiveAccounts(signal.userId);
    if (isCardPaymentMovementClass(movementClass)) {
      reasons.push(
        ...(await this.cardPaymentReasons({
          signal,
          candidate,
          status,
          accounts,
        })),
      );
      return orderFinanceReviewReasons(reasons);
    }
    if (isTransferMovementClass(movementClass)) {
      reasons.push(
        ...this.transferReasons({ candidate, movementClass, accounts }),
      );
      return orderFinanceReviewReasons(reasons);
    }
    reasons.push(
      ...(await this.instrumentReasons({
        signal,
        candidate,
        movementClass,
        accounts,
      })),
    );
    return orderFinanceReviewReasons(reasons);
  }

  private async reversalReasons({
    signal,
    candidate,
  }: {
    signal: RoutedSignal;
    candidate: SignalCandidate;
  }): Promise<string[]> {
    const canResolveReversalWithoutDate = Boolean(
      candidate.reverseOfBankReference ||
      candidate.reverseOfEmailMessageId ||
      !candidate.merchant ||
      candidate.transactionDate,
    );
    if (
      candidate.amount == null ||
      !candidate.currency ||
      !canResolveReversalWithoutDate
    ) {
      return [];
    }
    const reversalPlan = await this.reversalPlanner.build({
      signal,
      candidate,
    });
    if (
      reversalPlan.kind === 'RECORD' &&
      reversalPlan.status === 'REVIEW_REQUIRED' &&
      reversalPlan.reason
    ) {
      return [reversalPlan.reason];
    }
    return [];
  }

  private async cardPaymentReasons({
    signal,
    candidate,
    status,
    accounts,
  }: {
    signal: RoutedSignal;
    candidate: SignalCandidate;
    status: string;
    accounts: Awaited<ReturnType<SignalImportTargets['findActiveAccounts']>>;
  }): Promise<string[]> {
    const reasons: string[] = [];
    if (status !== 'CONFIRMED') {
      reasons.push('CARD_PAYMENT_NOT_CONFIRMED');
    }
    const card = await this.cardPaymentTargets.resolveCard({
      userId: signal.userId,
      lastFour: candidate.last4 ?? null,
    });
    if (card.kind === 'review') {
      reasons.push(card.reason);
    }
    const account = this.cardPaymentTargets.resolveAccount({
      accounts,
      accountNumberLast4: candidate.accountNumberLast4 ?? null,
    });
    if (account.kind === 'review') {
      reasons.push(account.reason);
    }
    if (
      card.kind === 'resolved' &&
      candidate.currency &&
      !card.currencies.includes(candidate.currency)
    ) {
      reasons.push('CARD_CURRENCY_MISSING');
    }
    return reasons;
  }

  private transferReasons({
    candidate,
    movementClass,
    accounts,
  }: {
    candidate: SignalCandidate;
    movementClass: MovementClass;
    accounts: Awaited<ReturnType<SignalImportTargets['findActiveAccounts']>>;
  }): string[] {
    const transferTarget = this.targets.resolveTransferTarget({
      candidate,
      movementClass,
      accounts,
    });
    return transferTarget.kind === 'review' ? [transferTarget.reason] : [];
  }

  private async instrumentReasons({
    signal,
    candidate,
    movementClass,
    accounts,
  }: {
    signal: RoutedSignal;
    candidate: SignalCandidate;
    movementClass: MovementClass;
    accounts: Awaited<ReturnType<SignalImportTargets['findActiveAccounts']>>;
  }): Promise<string[]> {
    const reasons: string[] = [];
    const cards = await this.targets.findActiveCards(signal.userId);
    const ledgerTarget = this.targets.resolveInstrumentTarget({
      candidate,
      movementClass,
      accounts,
      cards,
    });
    if (ledgerTarget.kind !== 'unique') {
      reasons.push(
        ledgerTarget.kind === 'ambiguous'
          ? 'AMBIGUOUS_LEDGER_TARGET'
          : 'NO_LEDGER_TARGET',
      );
    }
    if (isAtmMovementClass(movementClass)) {
      const cashAccountId = await this.targets.resolveCashAccountId(
        signal.userId,
      );
      if (!cashAccountId) {
        reasons.push('ATM_CASH_ACCOUNT_AMBIGUOUS');
      }
    }
    return reasons;
  }
}

function transferDirectionReasons({
  candidate,
  movementClass,
}: {
  candidate: SignalCandidate;
  movementClass: MovementClass;
}): string[] {
  const reasons: string[] = [];
  if (
    candidate.direction === 'TRANSFER' &&
    !isTransferMovementClass(movementClass)
  ) {
    reasons.push('TRANSFER_DIRECTION_AMBIGUOUS');
  }
  if (isTransferMovementClass(movementClass) && !candidate.direction) {
    reasons.push('TRANSFER_SIDE_MISSING');
  }
  return reasons;
}
