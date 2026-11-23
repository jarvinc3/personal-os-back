import type { JsonObject, NotificationIntent } from '@personal-os/contracts';
import type { FinanceDomainEvent, FinanceEventPayloads } from '../contracts';
import { FinanceEvents } from '../contracts';
import { FINANCE_NOTIFICATION_KEYS } from '../settings/finance-settings';
import {
  formatNotificationAmount,
  transactionRecordedCopy,
  transactionUpdatedCopy,
  transferRecordedCopy,
  type TransactionNotificationFields,
} from './finance-notification-copy';
import {
  buildFinanceIntent,
  FINANCE_MODULE_SLUG,
} from './finance-intent-builder';

const TRANSFER_SOURCE_LEG = 'SOURCE';

type TransactionPayload =
  FinanceEventPayloads[typeof FinanceEvents.TRANSACTION_CONFIRMED];

type ConfirmedEvent = FinanceDomainEvent<
  typeof FinanceEvents.TRANSACTION_CONFIRMED
>;

type UpdatedEvent = FinanceDomainEvent<
  typeof FinanceEvents.TRANSACTION_UPDATED
>;

/** A confirmed movement: its transfer notice goes out only for the source leg. */
export function transactionConfirmedIntents(
  event: ConfirmedEvent,
  userId: string,
): readonly NotificationIntent[] {
  const payload = event.payload;
  if (payload.announce === false || payload.status !== 'CONFIRMED') {
    return [];
  }
  if (payload.transferGroupId) {
    return transferIntents(event, userId);
  }
  return [
    buildFinanceIntent({
      event,
      userId,
      type: 'transaction.created',
      copy: transactionRecordedCopy(transactionFields(payload)),
      data: transactionNotificationData(payload),
      preferenceKey: FINANCE_NOTIFICATION_KEYS.transactionDetected,
    }),
  ];
}

export function transactionUpdatedIntents(
  event: UpdatedEvent,
  userId: string,
): readonly NotificationIntent[] {
  return [
    buildFinanceIntent({
      event,
      userId,
      type: 'transaction.updated',
      copy: transactionUpdatedCopy(transactionFields(event.payload)),
      data: transactionNotificationData(event.payload),
      preferenceKey: FINANCE_NOTIFICATION_KEYS.transactionDetected,
    }),
  ];
}

/** A transfer moves between the user's accounts: one notice, source leg. */
function transferIntents(
  event: ConfirmedEvent,
  userId: string,
): readonly NotificationIntent[] {
  const payload = event.payload;
  if (payload.legRole !== TRANSFER_SOURCE_LEG || !payload.transferGroupId) {
    return [];
  }
  return [
    buildFinanceIntent({
      event,
      userId,
      type: 'transaction.transfer',
      copy: transferRecordedCopy(transactionFields(payload)),
      data: transactionNotificationData(payload),
      preferenceKey: FINANCE_NOTIFICATION_KEYS.transactionDetected,
      identity: payload.transferGroupId,
    }),
  ];
}

function transactionFields(
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

function transactionNotificationData(payload: TransactionPayload): JsonObject {
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
