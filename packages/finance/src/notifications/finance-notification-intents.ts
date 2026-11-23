import type { NotificationIntent } from '@personal-os/contracts';
import type {
  FinanceDomainEvent,
  FinanceNotificationAdapter,
} from '../contracts';
import { FinanceEvents } from '../contracts';
import {
  balanceDriftIntents,
  budgetThresholdIntents,
  cardPaymentDueIntents,
  cardStatementReminderIntents,
  weeklySummaryIntents,
} from './finance-alert-intents';
import {
  recurringMissedIntents,
  recurringPriceChangedIntents,
  recurringUpcomingIntents,
  subscriptionRenewalDueIntents,
} from './finance-recurring-intents';
import {
  transactionConfirmedIntents,
  transactionUpdatedIntents,
} from './finance-transaction-intents';

/**
 * Translates Finance facts into neutral intents. Copy, preference and the
 * deduplication identity belong to Finance; delivery belongs to Notifications.
 */
export class FinanceNotificationIntents implements FinanceNotificationAdapter {
  // The switch is the table of events, not a branch of logic: every event name
  // has its line and a new one fails the build until it is declared here.
  // eslint-disable-next-line complexity -- un caso por tipo de evento
  toIntents(event: FinanceDomainEvent): readonly NotificationIntent[] {
    const userId = event.userId;
    if (!userId) {
      return [];
    }

    switch (event.eventName) {
      case FinanceEvents.TRANSACTION_CONFIRMED:
        return transactionConfirmedIntents(event, userId);
      case FinanceEvents.TRANSACTION_UPDATED:
        return transactionUpdatedIntents(event, userId);
      case FinanceEvents.BUDGET_THRESHOLD_CROSSED:
        return budgetThresholdIntents(event, userId);
      case FinanceEvents.CARD_STATEMENT_REMINDER:
        return cardStatementReminderIntents(event, userId);
      case FinanceEvents.CARD_PAYMENT_DUE:
        return cardPaymentDueIntents(event, userId);
      case FinanceEvents.WEEKLY_SUMMARY:
        return weeklySummaryIntents(event, userId);
      case FinanceEvents.RECURRING_PRICE_CHANGED:
        return recurringPriceChangedIntents(event, userId);
      case FinanceEvents.RECURRING_MISSED:
        return recurringMissedIntents(event, userId);
      case FinanceEvents.RECURRING_UPCOMING:
        return recurringUpcomingIntents(event, userId);
      case FinanceEvents.SUBSCRIPTION_RENEWAL_DUE:
        return subscriptionRenewalDueIntents(event, userId);
      case FinanceEvents.BALANCE_DRIFT_DETECTED:
        return balanceDriftIntents(event, userId);
      // Deleted, declined, cancelled, reversed and transfer rows carry no
      // notice of their own: the movement or its legs already announced it.
      case FinanceEvents.TRANSACTION_DELETED:
      case FinanceEvents.TRANSACTION_DECLINED:
      case FinanceEvents.TRANSACTION_CANCELLED:
      case FinanceEvents.TRANSACTION_REVERSED:
      case FinanceEvents.TRANSFER_CREATED:
        return [];
    }
  }
}
