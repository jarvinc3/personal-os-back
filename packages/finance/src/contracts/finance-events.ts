import type { DomainEvent, JsonObject } from '@personal-os/contracts';

/** Finance owns these names; Core only transports the event envelopes. */
export const FinanceEvents = {
  TRANSACTION_CONFIRMED: 'finance.transaction.confirmed',
  TRANSACTION_UPDATED: 'finance.transaction.updated',
  TRANSACTION_DECLINED: 'finance.transaction.declined',
  TRANSACTION_CANCELLED: 'finance.transaction.cancelled',
  TRANSACTION_REVERSED: 'finance.transaction.reversed',
  TRANSACTION_DELETED: 'finance.transaction.deleted',
  TRANSFER_CREATED: 'finance.transfer.created',
  BUDGET_THRESHOLD_CROSSED: 'finance.budget.threshold_crossed',
  CARD_STATEMENT_REMINDER: 'finance.card_statement.reminder',
  CARD_PAYMENT_DUE: 'finance.card_payment.due',
  WEEKLY_SUMMARY: 'finance.weekly_summary',
  RECURRING_PRICE_CHANGED: 'finance.recurring.price_changed',
  RECURRING_MISSED: 'finance.recurring.missed',
  RECURRING_UPCOMING: 'finance.recurring.upcoming',
  SUBSCRIPTION_RENEWAL_DUE: 'finance.subscription.renewal_due',
  BALANCE_DRIFT_DETECTED: 'finance.balance.drift_detected',
} as const;

export type FinanceEventName =
  (typeof FinanceEvents)[keyof typeof FinanceEvents];
export const FINANCE_EVENT_VERSION = 1 as const;

type TransactionPayload = JsonObject & {
  transactionId: string;
  amount: number;
  currency?: string;
  status?: string;
  source?: string;
  type?: string;
  merchant?: string | null;
  transferGroupId?: string | null;
  legRole?: string | null;
  accountName?: string | null;
  cardName?: string | null;
  categoryName?: string | null;
  categoryIcon?: string | null;
  categoryColor?: string | null;
  announce?: boolean;
};

export interface FinanceEventPayloads {
  [FinanceEvents.TRANSACTION_CONFIRMED]: TransactionPayload;
  [FinanceEvents.TRANSACTION_UPDATED]: TransactionPayload;
  [FinanceEvents.TRANSACTION_DECLINED]: TransactionPayload;
  [FinanceEvents.TRANSACTION_CANCELLED]: TransactionPayload;
  [FinanceEvents.TRANSACTION_REVERSED]: TransactionPayload;
  [FinanceEvents.TRANSACTION_DELETED]: {
    transactionId: string;
    transferGroupId: string | null;
    amount: number;
    status: string;
    source: string;
  };
  [FinanceEvents.TRANSFER_CREATED]: {
    transferGroupId: string;
    debitId: string;
    creditId: string;
    amount: number;
  };
  [FinanceEvents.BUDGET_THRESHOLD_CROSSED]: {
    budgetId: string;
    percentageUsed: number;
    alertId: string;
  };
  [FinanceEvents.CARD_STATEMENT_REMINDER]: { sourceId?: string | null };
  [FinanceEvents.CARD_PAYMENT_DUE]: {
    cardId: string;
    statementId: string;
    cardName: string;
    currency: string;
    closingBalance: number;
    remaining: number;
    minimumPayment: number;
    dueDate: string;
    daysUntil: number;
  };
  [FinanceEvents.WEEKLY_SUMMARY]: { weekStart: string; summary: JsonObject };
  [FinanceEvents.RECURRING_PRICE_CHANGED]: {
    patternId: string;
    merchant: string;
    currency: string;
    previousAmount: number;
    newAmount: number;
  };
  [FinanceEvents.RECURRING_MISSED]: {
    patternId: string;
    merchant: string;
    amount: number;
    currency: string;
    nextExpectedDate: string;
  };
  [FinanceEvents.RECURRING_UPCOMING]: {
    patternId: string;
    merchant: string;
    amount: number;
    currency: string;
    nextExpectedDate: string;
    daysUntil: number;
  };
  [FinanceEvents.SUBSCRIPTION_RENEWAL_DUE]: {
    subscriptionId: string;
    name: string;
    amount: number;
    currency: string;
    nextBillingDate: string;
    daysUntil: number;
  };
  [FinanceEvents.BALANCE_DRIFT_DETECTED]: {
    driftId: string;
    accountId: string | null;
    cardId: string | null;
    currency: string;
    name: string | null;
    storedBalance: string;
    expectedBalance: string;
    difference: string;
  };
}

export type FinanceDomainEvent<
  TName extends FinanceEventName = FinanceEventName,
> = TName extends FinanceEventName
  ? DomainEvent<FinanceEventPayloads[TName]> & {
      eventName: TName;
      version: typeof FINANCE_EVENT_VERSION;
    }
  : never;
