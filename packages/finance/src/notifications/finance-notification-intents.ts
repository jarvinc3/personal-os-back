import type { JsonObject, NotificationIntent } from '@personal-os/contracts';
import type {
  FinanceDomainEvent,
  FinanceEventPayloads,
  FinanceNotificationAdapter,
} from '../contracts';
import { FinanceEvents } from '../contracts';
import { FINANCE_NOTIFICATION_KEYS } from '../settings/finance-settings';
import {
  balanceDriftCopy,
  budgetThresholdCopy,
  cardPaymentDueCopy,
  cardStatementReminderCopy,
  formatNotificationAmount,
  recurringMissedCopy,
  recurringPriceChangedCopy,
  recurringUpcomingCopy,
  subscriptionRenewalDueCopy,
  transactionRecordedCopy,
  transactionUpdatedCopy,
  transferRecordedCopy,
  weeklySummaryCopy,
  type NotificationCopy,
  type TransactionNotificationFields,
} from './finance-notification-copy';

const SOURCE_DOMAIN = 'finance';
const FINANCE_MODULE_SLUG = 'finance';
const TRANSFER_SOURCE_LEG = 'SOURCE';
const IN_APP_ONLY = ['IN_APP'] as const;

type TransactionPayload =
  FinanceEventPayloads[typeof FinanceEvents.TRANSACTION_CONFIRMED];

/** Only the fields the weekly summary copy reads; the payload stays JSON. */
type WeeklySummaryRead = {
  currency?: string;
  expenses?: string;
  averageExpenses?: string;
  topCategories?: { name?: string }[];
  budgetsAtRisk?: unknown[];
  upcomingInstallments?: unknown[];
  pendingEmails?: number;
};

type IntentInput = {
  event: FinanceDomainEvent;
  userId: string;
  type: string;
  copy: NotificationCopy;
  data: JsonObject;
  preferenceKey?: string;
  /** Overrides the event id as the stable identity of the notice. */
  identity?: string;
};

/**
 * Translates Finance facts into neutral intents. Copy, preference and the
 * deduplication identity belong to Finance; delivery belongs to Notifications.
 */
export class FinanceNotificationIntents implements FinanceNotificationAdapter {
  toIntents(event: FinanceDomainEvent): readonly NotificationIntent[] {
    const userId = event.userId;
    if (!userId) {
      return [];
    }

    switch (event.eventName) {
      case FinanceEvents.TRANSACTION_CONFIRMED:
        return this.confirmedTransaction(event, userId);
      case FinanceEvents.TRANSACTION_UPDATED:
        return this.updatedTransaction(event, userId);
      case FinanceEvents.BUDGET_THRESHOLD_CROSSED:
        return this.budgetThreshold(event, userId);
      case FinanceEvents.CARD_STATEMENT_REMINDER:
        return this.cardStatementReminder(event, userId);
      case FinanceEvents.CARD_PAYMENT_DUE:
        return this.cardPaymentDue(event, userId);
      case FinanceEvents.WEEKLY_SUMMARY:
        return this.weeklySummary(event, userId);
      case FinanceEvents.RECURRING_PRICE_CHANGED:
        return this.recurringPriceChanged(event, userId);
      case FinanceEvents.RECURRING_MISSED:
        return this.recurringMissed(event, userId);
      case FinanceEvents.RECURRING_UPCOMING:
        return this.recurringUpcoming(event, userId);
      case FinanceEvents.SUBSCRIPTION_RENEWAL_DUE:
        return this.subscriptionRenewalDue(event, userId);
      case FinanceEvents.BALANCE_DRIFT_DETECTED:
        return this.balanceDrift(event, userId);
      default:
        // Deleted, declined, cancelled, reversed and transfer rows carry no
        // notice of their own: the movement or its legs already announced it.
        return [];
    }
  }

  private confirmedTransaction(
    event: FinanceDomainEvent<typeof FinanceEvents.TRANSACTION_CONFIRMED>,
    userId: string,
  ): readonly NotificationIntent[] {
    const payload = event.payload;
    if (payload.announce === false || payload.status !== 'CONFIRMED') {
      return [];
    }
    if (payload.transferGroupId) {
      return this.transfer(event, userId);
    }
    return [
      this.intent({
        event,
        userId,
        type: 'transaction.created',
        copy: transactionRecordedCopy(this.transactionFields(payload)),
        data: this.transactionNotificationData(payload),
        preferenceKey: FINANCE_NOTIFICATION_KEYS.transactionDetected,
      }),
    ];
  }

  /** A transfer moves between the user's accounts: one notice, source leg. */
  private transfer(
    event: FinanceDomainEvent<typeof FinanceEvents.TRANSACTION_CONFIRMED>,
    userId: string,
  ): readonly NotificationIntent[] {
    const payload = event.payload;
    if (payload.legRole !== TRANSFER_SOURCE_LEG || !payload.transferGroupId) {
      return [];
    }
    return [
      this.intent({
        event,
        userId,
        type: 'transaction.transfer',
        copy: transferRecordedCopy(this.transactionFields(payload)),
        data: this.transactionNotificationData(payload),
        preferenceKey: FINANCE_NOTIFICATION_KEYS.transactionDetected,
        identity: payload.transferGroupId,
      }),
    ];
  }

  private updatedTransaction(
    event: FinanceDomainEvent<typeof FinanceEvents.TRANSACTION_UPDATED>,
    userId: string,
  ): readonly NotificationIntent[] {
    return [
      this.intent({
        event,
        userId,
        type: 'transaction.updated',
        copy: transactionUpdatedCopy(this.transactionFields(event.payload)),
        data: this.transactionNotificationData(event.payload),
        preferenceKey: FINANCE_NOTIFICATION_KEYS.transactionDetected,
      }),
    ];
  }

  private budgetThreshold(
    event: FinanceDomainEvent<typeof FinanceEvents.BUDGET_THRESHOLD_CROSSED>,
    userId: string,
  ): readonly NotificationIntent[] {
    const payload = event.payload;
    return [
      this.intent({
        event,
        userId,
        type: 'budget.threshold_reached',
        copy: budgetThresholdCopy(payload.percentageUsed),
        data: {
          moduleSlug: FINANCE_MODULE_SLUG,
          notificationKey: FINANCE_NOTIFICATION_KEYS.budgetAlerts,
          budgetId: payload.budgetId,
          percentageUsed: payload.percentageUsed,
        },
        preferenceKey: FINANCE_NOTIFICATION_KEYS.budgetAlerts,
      }),
    ];
  }

  private cardStatementReminder(
    event: FinanceDomainEvent<typeof FinanceEvents.CARD_STATEMENT_REMINDER>,
    userId: string,
  ): readonly NotificationIntent[] {
    return [
      this.intent({
        event,
        userId,
        type: 'card.statement_reminder',
        copy: cardStatementReminderCopy(),
        data: {
          moduleSlug: FINANCE_MODULE_SLUG,
          reminder: 'card_statement',
          sourceId: event.payload.sourceId ?? null,
        },
      }),
    ];
  }

  private cardPaymentDue(
    event: FinanceDomainEvent<typeof FinanceEvents.CARD_PAYMENT_DUE>,
    userId: string,
  ): readonly NotificationIntent[] {
    const payload = event.payload;
    return [
      this.intent({
        event,
        userId,
        type: 'card.payment_due',
        copy: cardPaymentDueCopy({
          cardName: payload.cardName.trim() ? payload.cardName : 'tu tarjeta',
          remainingLabel: formatNotificationAmount(
            payload.remaining,
            payload.currency,
          ),
          daysUntil: payload.daysUntil,
        }),
        data: {
          moduleSlug: FINANCE_MODULE_SLUG,
          notificationKey: FINANCE_NOTIFICATION_KEYS.cardDueDate,
          cardId: payload.cardId,
          statementId: payload.statementId,
          dueDate: payload.dueDate,
        },
        preferenceKey: FINANCE_NOTIFICATION_KEYS.cardDueDate,
      }),
    ];
  }

  private weeklySummary(
    event: FinanceDomainEvent<typeof FinanceEvents.WEEKLY_SUMMARY>,
    userId: string,
  ): readonly NotificationIntent[] {
    const payload = event.payload;
    const summary = payload.summary as WeeklySummaryRead;
    const currency = summary.currency ?? '';
    const average = Number(summary.averageExpenses ?? 0);
    return [
      this.intent({
        event,
        userId,
        type: 'finance.weekly_summary',
        copy: weeklySummaryCopy({
          amountLabel: formatNotificationAmount(
            Number(summary.expenses ?? 0),
            currency,
          ),
          averageLabel:
            average > 0 ? formatNotificationAmount(average, currency) : '',
          topCategories: (summary.topCategories ?? []).flatMap((category) =>
            category.name ? [category.name] : [],
          ),
          budgetsAtRisk: (summary.budgetsAtRisk ?? []).length,
          upcoming: (summary.upcomingInstallments ?? []).length,
          pendingEmails: summary.pendingEmails ?? 0,
        }),
        data: {
          moduleSlug: FINANCE_MODULE_SLUG,
          notificationKey: FINANCE_NOTIFICATION_KEYS.weeklySummary,
          weekStart: payload.weekStart,
        },
        preferenceKey: FINANCE_NOTIFICATION_KEYS.weeklySummary,
      }),
    ];
  }

  private recurringPriceChanged(
    event: FinanceDomainEvent<typeof FinanceEvents.RECURRING_PRICE_CHANGED>,
    userId: string,
  ): readonly NotificationIntent[] {
    const payload = event.payload;
    return [
      this.intent({
        event,
        userId,
        type: 'recurring.price_changed',
        copy: recurringPriceChangedCopy({
          merchant: payload.merchant,
          previousLabel: formatNotificationAmount(
            payload.previousAmount,
            payload.currency,
          ),
          newLabel: formatNotificationAmount(
            payload.newAmount,
            payload.currency,
          ),
        }),
        data: {
          moduleSlug: FINANCE_MODULE_SLUG,
          notificationKey: FINANCE_NOTIFICATION_KEYS.priceIncreaseAlerts,
          patternId: payload.patternId,
        },
        preferenceKey: FINANCE_NOTIFICATION_KEYS.priceIncreaseAlerts,
      }),
    ];
  }

  private recurringMissed(
    event: FinanceDomainEvent<typeof FinanceEvents.RECURRING_MISSED>,
    userId: string,
  ): readonly NotificationIntent[] {
    const payload = event.payload;
    return [
      this.intent({
        event,
        userId,
        type: 'recurring.missed',
        copy: recurringMissedCopy({
          merchant: payload.merchant,
          amountLabel: formatNotificationAmount(
            payload.amount,
            payload.currency,
          ),
        }),
        data: this.recurringNotificationData(payload.patternId),
        preferenceKey: FINANCE_NOTIFICATION_KEYS.recurringAlerts,
      }),
    ];
  }

  private recurringUpcoming(
    event: FinanceDomainEvent<typeof FinanceEvents.RECURRING_UPCOMING>,
    userId: string,
  ): readonly NotificationIntent[] {
    const payload = event.payload;
    return [
      this.intent({
        event,
        userId,
        type: 'recurring.upcoming',
        copy: recurringUpcomingCopy({
          merchant: payload.merchant,
          amountLabel: formatNotificationAmount(
            payload.amount,
            payload.currency,
          ),
          daysUntil: payload.daysUntil,
        }),
        data: this.recurringNotificationData(payload.patternId),
        preferenceKey: FINANCE_NOTIFICATION_KEYS.recurringAlerts,
      }),
    ];
  }

  private recurringNotificationData(patternId: string): JsonObject {
    return {
      moduleSlug: FINANCE_MODULE_SLUG,
      notificationKey: FINANCE_NOTIFICATION_KEYS.recurringAlerts,
      patternId,
    };
  }

  private subscriptionRenewalDue(
    event: FinanceDomainEvent<typeof FinanceEvents.SUBSCRIPTION_RENEWAL_DUE>,
    userId: string,
  ): readonly NotificationIntent[] {
    const payload = event.payload;
    return [
      this.intent({
        event,
        userId,
        type: 'subscription.renewal_due',
        copy: subscriptionRenewalDueCopy({
          merchant: payload.name,
          amountLabel: formatNotificationAmount(
            payload.amount,
            payload.currency,
          ),
          daysUntil: payload.daysUntil,
        }),
        data: {
          moduleSlug: FINANCE_MODULE_SLUG,
          notificationKey: FINANCE_NOTIFICATION_KEYS.subscriptionReminders,
          subscriptionId: payload.subscriptionId,
          nextBillingDate: payload.nextBillingDate,
        },
        preferenceKey: FINANCE_NOTIFICATION_KEYS.subscriptionReminders,
      }),
    ];
  }

  private balanceDrift(
    event: FinanceDomainEvent<typeof FinanceEvents.BALANCE_DRIFT_DETECTED>,
    userId: string,
  ): readonly NotificationIntent[] {
    const payload = event.payload;
    return [
      this.intent({
        event,
        userId,
        type: 'finance.balance_drift',
        copy: balanceDriftCopy({
          name: payload.name?.trim() ? payload.name : 'una cuenta',
          differenceLabel: formatNotificationAmount(
            Number(payload.difference ?? 0),
            payload.currency,
          ),
        }),
        data: {
          moduleSlug: FINANCE_MODULE_SLUG,
          notificationKey: FINANCE_NOTIFICATION_KEYS.balanceIntegrity,
          driftId: payload.driftId,
          accountId: payload.accountId ?? null,
          cardId: payload.cardId ?? null,
          currency: payload.currency,
        },
        preferenceKey: FINANCE_NOTIFICATION_KEYS.balanceIntegrity,
      }),
    ];
  }

  private transactionFields(
    payload: TransactionPayload,
  ): TransactionNotificationFields {
    return {
      type: payload.type ?? '',
      amountLabel: formatNotificationAmount(
        payload.amount,
        payload.currency ?? '',
      ),
      merchant: payload.merchant ?? null,
      categoryName: payload.categoryName ?? null,
      accountName: payload.accountName ?? null,
      cardName: payload.cardName ?? null,
    };
  }

  private transactionNotificationData(payload: TransactionPayload): JsonObject {
    return {
      moduleSlug: FINANCE_MODULE_SLUG,
      notificationKey: FINANCE_NOTIFICATION_KEYS.transactionDetected,
      transactionId: payload.transactionId,
      status: payload.status ?? null,
      amount: payload.amount,
      currency: payload.currency ?? null,
      merchant: payload.merchant ?? null,
      accountName: payload.accountName ?? null,
      cardName: payload.cardName ?? null,
      categoryName: payload.categoryName ?? null,
      categoryIcon: payload.categoryIcon ?? null,
      categoryColor: payload.categoryColor ?? null,
    };
  }

  private intent(input: IntentInput): NotificationIntent {
    const identity = input.identity ?? input.event.eventId;
    return {
      schemaVersion: 1,
      userId: input.userId,
      sourceDomain: SOURCE_DOMAIN,
      type: input.type,
      ...(input.preferenceKey === undefined
        ? {}
        : { preferenceKey: input.preferenceKey }),
      title: input.copy.title,
      body: input.copy.body,
      data: input.data,
      requestedChannels: [...IN_APP_ONLY],
      deduplicationKey: `${SOURCE_DOMAIN}:${input.type}:${identity}`,
      occurredAt: input.event.occurredAt,
      cause: {
        eventId: input.event.eventId,
        eventName: input.event.eventName,
      },
    };
  }
}
