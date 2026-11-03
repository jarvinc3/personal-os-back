import { FinanceEvents } from '../../contracts';

export function transactionCreatedEventName(status: string): string {
  switch (status) {
    case 'CONFIRMED':
      return FinanceEvents.TRANSACTION_CONFIRMED;
    case 'DECLINED':
      return FinanceEvents.TRANSACTION_DECLINED;
    case 'CANCELLED':
      return FinanceEvents.TRANSACTION_CANCELLED;
    case 'REVERSED':
      return FinanceEvents.TRANSACTION_REVERSED;
    default:
      return FinanceEvents.TRANSACTION_IMPORTED;
  }
}

type NotificationTransactionRow = {
  id: string;
  amount: { toString(): string } | number;
  currency: string;
  status: string;
  source: string;
  type: string;
  merchant: string | null;
  transferGroupId: string | null;
  legRole: string | null;
  account: { name: string } | null;
  card: { name: string } | null;
  category: { name: string; icon: string | null; color: string | null } | null;
};

/**
 * Payload shared with the notifications listener. It carries the display fields
 * the notification still needs, so the listener does not reach into finance.
 */
export function notificationTransactionPayload(
  row: NotificationTransactionRow,
) {
  return {
    transactionId: row.id,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    source: row.source,
    type: row.type,
    merchant: row.merchant,
    transferGroupId: row.transferGroupId,
    legRole: row.legRole,
    accountName: row.account?.name ?? null,
    cardName: row.card?.name ?? null,
    categoryName: row.category?.name ?? null,
    categoryIcon: row.category?.icon ?? null,
    categoryColor: row.category?.color ?? null,
  };
}

export function decimalToString(
  value: { toString(): string } | number | null | undefined,
): string {
  if (value === null || value === undefined) {
    return '0';
  }
  return value.toString();
}

export function decimalToNullableString(
  value: { toString(): string } | number | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value.toString();
}
