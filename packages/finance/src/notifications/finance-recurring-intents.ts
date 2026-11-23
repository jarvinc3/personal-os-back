import type { JsonObject, NotificationIntent } from '@personal-os/contracts';
import type { FinanceDomainEvent } from '../contracts';
import { FinanceEvents } from '../contracts';
import { FINANCE_NOTIFICATION_KEYS } from '../settings/finance-settings';
import {
  formatNotificationAmount,
  recurringMissedCopy,
  recurringPriceChangedCopy,
  recurringUpcomingCopy,
  subscriptionRenewalDueCopy,
} from './finance-notification-copy';
import {
  buildFinanceIntent,
  FINANCE_MODULE_SLUG,
} from './finance-intent-builder';

export function recurringPriceChangedIntents(
  event: FinanceDomainEvent<typeof FinanceEvents.RECURRING_PRICE_CHANGED>,
  userId: string,
): readonly NotificationIntent[] {
  const payload = event.payload;
  return [
    buildFinanceIntent({
      event,
      userId,
      type: 'recurring.price_changed',
      copy: recurringPriceChangedCopy({
        merchant: payload.merchant,
        previousLabel: formatNotificationAmount(
          payload.previousAmount,
          payload.currency,
        ),
        newLabel: formatNotificationAmount(payload.newAmount, payload.currency),
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

export function recurringMissedIntents(
  event: FinanceDomainEvent<typeof FinanceEvents.RECURRING_MISSED>,
  userId: string,
): readonly NotificationIntent[] {
  const payload = event.payload;
  return [
    buildFinanceIntent({
      event,
      userId,
      type: 'recurring.missed',
      copy: recurringMissedCopy({
        merchant: payload.merchant,
        amountLabel: formatNotificationAmount(payload.amount, payload.currency),
      }),
      data: recurringNotificationData(payload.patternId),
      preferenceKey: FINANCE_NOTIFICATION_KEYS.recurringAlerts,
    }),
  ];
}

export function recurringUpcomingIntents(
  event: FinanceDomainEvent<typeof FinanceEvents.RECURRING_UPCOMING>,
  userId: string,
): readonly NotificationIntent[] {
  const payload = event.payload;
  return [
    buildFinanceIntent({
      event,
      userId,
      type: 'recurring.upcoming',
      copy: recurringUpcomingCopy({
        merchant: payload.merchant,
        amountLabel: formatNotificationAmount(payload.amount, payload.currency),
        daysUntil: payload.daysUntil,
      }),
      data: recurringNotificationData(payload.patternId),
      preferenceKey: FINANCE_NOTIFICATION_KEYS.recurringAlerts,
    }),
  ];
}

export function subscriptionRenewalDueIntents(
  event: FinanceDomainEvent<typeof FinanceEvents.SUBSCRIPTION_RENEWAL_DUE>,
  userId: string,
): readonly NotificationIntent[] {
  const payload = event.payload;
  return [
    buildFinanceIntent({
      event,
      userId,
      type: 'subscription.renewal_due',
      copy: subscriptionRenewalDueCopy({
        merchant: payload.name,
        amountLabel: formatNotificationAmount(payload.amount, payload.currency),
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

function recurringNotificationData(patternId: string): JsonObject {
  return {
    moduleSlug: FINANCE_MODULE_SLUG,
    notificationKey: FINANCE_NOTIFICATION_KEYS.recurringAlerts,
    patternId,
  };
}
