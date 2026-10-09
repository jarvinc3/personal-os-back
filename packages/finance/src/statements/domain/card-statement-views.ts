import { roundMoney } from '../../shared/domain/money';
import {
  paymentsInWindow,
  type StatementMovement,
} from './card-statement-amounts';

export const CARD_STATEMENT_STATUSES = ['PENDING', 'PARTIAL', 'PAID'] as const;
export type CardStatementStatus = (typeof CARD_STATEMENT_STATUSES)[number];

export type CardStatementSnapshot = {
  id: string;
  currency: string;
  cycleStart: Date;
  cycleEnd: Date;
  dueDate: Date | null;
  /** Debt at closing, not the card's stored balance. */
  closingBalance: number;
};

export type CardStatementView = CardStatementSnapshot & {
  amountPaid: number;
  remaining: number;
  status: CardStatementStatus;
};

export function cardStatementStatus(input: {
  closingBalance: number;
  amountPaid: number;
}): CardStatementStatus {
  if (input.closingBalance <= 0) {
    return 'PAID';
  }
  if (input.amountPaid <= 0) {
    return 'PENDING';
  }
  if (input.amountPaid >= input.closingBalance) {
    return 'PAID';
  }
  return 'PARTIAL';
}

/**
 * A payment belongs to the statement whose window it falls in: up to the next
 * closing of the same currency, or today for the newest statement.
 */
function paymentWindowEnd(
  statement: CardStatementSnapshot,
  closingDates: readonly Date[],
  today: Date,
): Date {
  const nextClosing = closingDates.find(
    (closingDate) => closingDate.getTime() > statement.cycleEnd.getTime(),
  );
  if (!nextClosing) {
    return today;
  }
  return nextClosing.getTime() > today.getTime() ? today : nextClosing;
}

function closingDatesByCurrency(
  statements: readonly CardStatementSnapshot[],
): Map<string, Date[]> {
  const dates = new Map<string, Date[]>();
  for (const statement of statements) {
    const byDate = dates.get(statement.currency) ?? [];
    byDate.push(statement.cycleEnd);
    dates.set(statement.currency, byDate);
  }
  for (const byDate of dates.values()) {
    byDate.sort((left, right) => left.getTime() - right.getTime());
  }
  return dates;
}

export function buildCardStatementViews(input: {
  statements: readonly CardStatementSnapshot[];
  movements: readonly StatementMovement[];
  today: Date;
}): CardStatementView[] {
  const { statements, movements, today } = input;
  const closingDates = closingDatesByCurrency(statements);

  return statements.map((statement) => {
    const currencyMovements = movements.filter(
      (movement) => movement.ledgerCurrency === statement.currency,
    );
    const amountPaid = paymentsInWindow(
      currencyMovements,
      statement.cycleEnd,
      paymentWindowEnd(
        statement,
        closingDates.get(statement.currency) ?? [],
        today,
      ),
    );
    return {
      ...statement,
      amountPaid,
      remaining: roundMoney(Math.max(0, statement.closingBalance - amountPaid)),
      status: cardStatementStatus({
        closingBalance: statement.closingBalance,
        amountPaid,
      }),
    };
  });
}
