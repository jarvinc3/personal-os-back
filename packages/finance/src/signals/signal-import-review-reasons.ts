import type { RoutedSignal } from '@personal-os/contracts';
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
import {
  parseSignalPayload,
  resolveImportStatus,
  resolveMovementClass,
  type SignalCandidate,
} from './signal-import-payload';
import type { CardPaymentTargets } from './signal-card-payment-targets';
import type { SignalImportTargets } from './signal-import-targets';
import type { SignalReversalPlanner } from './signal-reversal-planner';

/**
 * Reúne los motivos de revisión que la corrida todavía no usó para decidir.
 * Solo lee el payload y los destinos; no escribe ni cambia el plan.
 */
export class SignalImportReviewReasons {
  constructor(
    private readonly targets: SignalImportTargets,
    private readonly cardPaymentTargets: CardPaymentTargets,
    private readonly reversalPlanner: SignalReversalPlanner,
  ) {}

  async collect({
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
