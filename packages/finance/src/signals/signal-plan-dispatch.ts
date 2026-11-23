import { Injectable } from '@nestjs/common';
import type { RoutedSignal } from '@personal-os/contracts';
import { isCardPaymentMovementClass } from '../ledger/domain/movement-class';
import type {
  ImportPlan,
  ImportResolutionOverride,
} from './signal-import-plan';
import type { PreparedMovement } from './signal-import-planner';
import { CardPaymentPlanner } from './signal-card-payment-planner';
import type {
  ActiveLedgerAccount,
  ActiveLedgerCard,
} from './signal-import-targets';
import { SignalMovementPlanner } from './signal-movement-planner';
import { SignalReversalPlanner } from './signal-reversal-planner';

type PlanDispatchInput = {
  prepared: PreparedMovement;
  signal: RoutedSignal;
  accounts: readonly ActiveLedgerAccount[];
  cards: readonly ActiveLedgerCard[];
  override?: ImportResolutionOverride;
};

/** Sends a prepared movement to the planner of its class. */
@Injectable()
export class SignalPlanDispatch {
  constructor(
    private readonly movement: SignalMovementPlanner,
    private readonly reversal: SignalReversalPlanner,
    private readonly cardPayment: CardPaymentPlanner,
  ) {}

  decide({
    prepared,
    signal,
    accounts,
    cards,
    override,
  }: PlanDispatchInput): Promise<ImportPlan> {
    if (prepared.status === 'REVERSED') {
      return this.reversal.build({
        signal,
        candidate: prepared.candidate,
        originalTransactionId: override?.originalTransactionId,
      });
    }
    if (isCardPaymentMovementClass(prepared.movementClass)) {
      return this.cardPayment.build({
        signal,
        payload: prepared.payload,
        candidate: prepared.candidate,
        accounts,
        status: prepared.status,
        cardId: override?.destination?.cardId,
        sourceAccountId: override?.destination?.accountId,
      });
    }
    return this.movement.plan({
      signal,
      payload: prepared.payload,
      candidate: prepared.candidate,
      movementClass: prepared.movementClass,
      type: prepared.type,
      status: prepared.status,
      amount: prepared.amount,
      currency: prepared.currency,
      transactionDate: prepared.transactionDate,
      accounts,
      cards,
      override,
    });
  }
}
