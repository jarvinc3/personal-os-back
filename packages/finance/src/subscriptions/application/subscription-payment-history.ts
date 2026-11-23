import type { Prisma } from '@personal-os/database';

export type SubscriptionPaymentRow =
  Prisma.FinSubscriptionPaymentGetPayload<object>;

/** Payments of every subscription, newest first inside each list. */
export function groupPaymentsBySubscription(
  rows: SubscriptionPaymentRow[],
): Map<string, SubscriptionPaymentRow[]> {
  const grouped = new Map<string, SubscriptionPaymentRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.subscriptionId) ?? [];
    list.push(row);
    grouped.set(row.subscriptionId, list);
  }
  return grouped;
}
