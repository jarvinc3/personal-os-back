import { roundMoney } from '../../shared/domain/money';
import {
  paymentsInWindow,
  type StatementMovement,
} from './card-statement-amounts';

export const CARD_STATEMENT_STATUSES = [
  'OPEN',
  'CLOSED',
  'PARTIAL',
  'MINIMUM_PAID',
  'PAID',
  'OVERDUE',
] as const;
export type CardStatementStatus = (typeof CARD_STATEMENT_STATUSES)[number];

export const CARD_STATEMENT_MINIMUM_SOURCES = [
  'IMPORTED',
  'ESTIMATED',
  'MANUAL',
] as const;
export type CardStatementMinimumSource =
  (typeof CARD_STATEMENT_MINIMUM_SOURCES)[number];

export type CardStatementSnapshot = {
  id: string;
  currency: string;
  cycleStart: Date;
  cycleEnd: Date;
  dueDate: Date | null;
  /** Debt at closing, not the card's stored balance. */
  closingBalance: number;
  minimumPayment: number | null;
  minimumSource: CardStatementMinimumSource | null;
};

export type CardStatementView = CardStatementSnapshot & {
  minimumPayment: number;
  minimumSource: CardStatementMinimumSource;
  paidAmount: number;
  remaining: number;
  status: CardStatementStatus;
};

/** 1/36 of the closing balance when the statement has no imported minimum. */
export function estimateMinimumPayment(closingBalance: number): number {
  return roundMoney(Math.max(closingBalance / 36, 0));
}

export function cardStatementStatus(input: {
  cycleEnd: Date;
  dueDate: Date | null;
  closingBalance: number;
  minimumPayment: number;
  paidAmount: number;
  today: Date;
}): CardStatementStatus {
  if (input.cycleEnd.getTime() >= input.today.getTime()) {
    return 'OPEN';
  }
  if (input.closingBalance <= 0 || input.paidAmount >= input.closingBalance) {
    return 'PAID';
  }
  if (
    input.dueDate &&
    input.dueDate.getTime() < input.today.getTime() &&
    input.paidAmount < input.minimumPayment
  ) {
    return 'OVERDUE';
  }
  if (input.minimumPayment > 0 && input.paidAmount >= input.minimumPayment) {
    return 'MINIMUM_PAID';
  }
  if (input.paidAmount > 0) {
    return 'PARTIAL';
  }
  return 'CLOSED';
}

/** Payments counted for a statement fall inside `(cycleEnd, dueDate]`. */
function paymentWindowEnd(statement: CardStatementSnapshot, today: Date): Date {
  if (statement.dueDate && statement.dueDate.getTime() < today.getTime()) {
    return statement.dueDate;
  }
  return today;
}

export function buildCardStatementViews(input: {
  statements: readonly CardStatementSnapshot[];
  movements: readonly StatementMovement[];
  today: Date;
}): CardStatementView[] {
  const { statements, movements, today } = input;

  return statements.map((statement) => {
    const currencyMovements = movements.filter(
      (movement) => movement.ledgerCurrency === statement.currency,
    );
    const paidAmount = paymentsInWindow(
      currencyMovements,
      statement.cycleEnd,
      paymentWindowEnd(statement, today),
    );
    const minimumPayment =
      statement.minimumPayment ??
      estimateMinimumPayment(statement.closingBalance);
    const minimumSource = statement.minimumSource ?? 'ESTIMATED';
    return {
      ...statement,
      minimumPayment,
      minimumSource,
      paidAmount,
      remaining: roundMoney(Math.max(0, statement.closingBalance - paidAmount)),
      status: cardStatementStatus({
        cycleEnd: statement.cycleEnd,
        dueDate: statement.dueDate,
        closingBalance: statement.closingBalance,
        minimumPayment,
        paidAmount,
        today,
      }),
    };
  });
}
