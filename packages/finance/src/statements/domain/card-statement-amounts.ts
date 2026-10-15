import { signedAmount } from '../../shared/domain/ledger-rules';
import { roundMoney } from '../../shared/domain/money';
import {
  PENDING_TRANSACTION_STATUS,
  type FinTransactionTypeValue,
} from '../../shared/domain/transaction-status';

export const CONFIRMED_TRANSACTION_STATUS = 'CONFIRMED';

export type StatementMovement = {
  type: FinTransactionTypeValue;
  status: string;
  ledgerAmount: { toString(): string } | number | string;
  ledgerCurrency: string;
  transactionDate: Date;
};

/**
 * Same signed delta the ledger applies to a card balance, so a statement can
 * never disagree with the live balance.
 */
export function statementLedgerDelta(
  movement: Pick<StatementMovement, 'type' | 'ledgerAmount'>,
): number {
  if (movement.type === 'CARD_PAYMENT') {
    return Math.abs(Number(movement.ledgerAmount));
  }
  return signedAmount(movement.type, Number(movement.ledgerAmount));
}

function isStatementMovement(movement: StatementMovement): boolean {
  return movement.status === CONFIRMED_TRANSACTION_STATUS;
}

function isInsideWindow(
  movement: StatementMovement,
  fromExclusive: Date,
  toInclusive: Date,
): boolean {
  const time = movement.transactionDate.getTime();
  return (
    isStatementMovement(movement) &&
    time > fromExclusive.getTime() &&
    time <= toInclusive.getTime()
  );
}

/**
 * Net change of the card's available credit inside (fromExclusive, toInclusive].
 * `FinCardBalance.balance` is that available credit, so a purchase lowers it.
 */
export function availableCreditDelta(
  movements: readonly StatementMovement[],
  fromExclusive: Date,
  toInclusive: Date,
): number {
  let delta = 0;
  for (const movement of movements) {
    if (isInsideWindow(movement, fromExclusive, toInclusive)) {
      delta += statementLedgerDelta(movement);
    }
  }
  return roundMoney(delta);
}

/** Payments credited to the card inside (fromExclusive, toInclusive]. */
export function paymentsInWindow(
  movements: readonly StatementMovement[],
  fromExclusive: Date,
  toInclusive: Date,
): number {
  let paid = 0;
  for (const movement of movements) {
    if (!isInsideWindow(movement, fromExclusive, toInclusive)) {
      continue;
    }
    const delta = statementLedgerDelta(movement);
    if (delta > 0) {
      paid += delta;
    }
  }
  return roundMoney(paid);
}

/**
 * Net change of the card's available credit from movements still pending.
 * A purchase already registered but not confirmed spends part of the limit.
 */
export function pendingCreditDelta(
  movements: readonly StatementMovement[],
): number {
  let delta = 0;
  for (const movement of movements) {
    if (movement.status === PENDING_TRANSACTION_STATUS) {
      delta += statementLedgerDelta(movement);
    }
  }
  return roundMoney(delta);
}

/**
 * Credit available right now: `FinCardBalance.balance` holds the available
 * credit already confirmed, plus the pending movements that also use it. A
 * purchase is a negative delta, so it lowers the available credit.
 */
export function availableCredit(input: {
  storedAvailable: number;
  movements: readonly StatementMovement[];
}): number {
  return roundMoney(
    input.storedAvailable + pendingCreditDelta(input.movements),
  );
}

/**
 * Debt at a past closing, derived from today's available credit plus the
 * movements since that closing. Invariant over time while those movements do
 * not change, so it is a safe snapshot.
 */
export function debtAtClosing(input: {
  currentAvailable: number;
  creditLimit: number;
  movements: readonly StatementMovement[];
  closingDate: Date;
  today: Date;
}): number {
  const availableAtClosing =
    input.currentAvailable -
    availableCreditDelta(input.movements, input.closingDate, input.today);
  return Math.max(0, roundMoney(input.creditLimit - availableAtClosing));
}
