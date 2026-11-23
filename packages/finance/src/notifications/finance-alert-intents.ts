import type { NotificationIntent } from '@personal-os/contracts';
import type { FinanceDomainEvent } from '../contracts';
import { FinanceEvents } from '../contracts';
import { FINANCE_NOTIFICATION_KEYS } from '../settings/finance-settings';
import {
  balanceDriftCopy,
  budgetThresholdCopy,
  cardPaymentDueCopy,
  cardStatementReminderCopy,
  formatNotificationAmount,
  weeklySummaryCopy,
} from './finance-notification-copy';
import {
  buildFinanceIntent,
  FINANCE_MODULE_SLUG,
} from './finance-intent-builder';

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

/** Notices that do not come from a movement: budgets, cards, summary and drift. */
export function budgetThresholdIntents(
  event: FinanceDomainEvent<typeof FinanceEvents.BUDGET_THRESHOLD_CROSSED>,
  userId: string,
): readonly NotificationIntent[] {
  const payload = event.payload;
  return [
    buildFinanceIntent({
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

export function cardStatementReminderIntents(
  event: FinanceDomainEvent<typeof FinanceEvents.CARD_STATEMENT_REMINDER>,
  userId: string,
): readonly NotificationIntent[] {
  return [
    buildFinanceIntent({
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

export function cardPaymentDueIntents(
  event: FinanceDomainEvent<typeof FinanceEvents.CARD_PAYMENT_DUE>,
  userId: string,
): readonly NotificationIntent[] {
  const payload = event.payload;
  return [
    buildFinanceIntent({
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

export function weeklySummaryIntents(
  event: FinanceDomainEvent<typeof FinanceEvents.WEEKLY_SUMMARY>,
  userId: string,
): readonly NotificationIntent[] {
  const payload = event.payload;
  const summary = payload.summary as WeeklySummaryRead;
  const currency = summary.currency ?? '';
  const average = Number(summary.averageExpenses ?? 0);
  return [
    buildFinanceIntent({
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

export function balanceDriftIntents(
  event: FinanceDomainEvent<typeof FinanceEvents.BALANCE_DRIFT_DETECTED>,
  userId: string,
): readonly NotificationIntent[] {
  const payload = event.payload;
  return [
    buildFinanceIntent({
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
