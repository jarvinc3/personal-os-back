/** Cycle groups the subscription list can filter by. */
export const SUBSCRIPTION_FREQUENCIES = ['MONTHLY', 'YEARLY', 'OTHER'] as const;

export type SubscriptionFrequency = (typeof SUBSCRIPTION_FREQUENCIES)[number];

/** Orders the subscription list accepts. */
export const SUBSCRIPTION_SORTS = ['NEXT_DATE', 'AMOUNT', 'NAME'] as const;

export type SubscriptionSort = (typeof SUBSCRIPTION_SORTS)[number];

export const DEFAULT_SUBSCRIPTION_SORT: SubscriptionSort = 'NEXT_DATE';

const AMOUNT_KEY = /^\d+(\.\d{1,2})?$/;

/**
 * Cursor key of a row for the active order. It has to match the column the
 * repository sorts by, or the next page would skip or repeat rows.
 */
export function subscriptionCursorKey(input: {
  sort: SubscriptionSort;
  nextBillingDate: Date;
  amount: string;
  name: string;
}): string {
  if (input.sort === 'AMOUNT') {
    return input.amount;
  }
  if (input.sort === 'NAME') {
    return input.name;
  }
  return input.nextBillingDate.toISOString();
}

/** Whether a decoded cursor key is usable with that order. */
export function isValidSubscriptionCursorKey(
  sort: SubscriptionSort,
  key: string,
): boolean {
  if (sort === 'AMOUNT') {
    return AMOUNT_KEY.test(key);
  }
  if (sort === 'NAME') {
    return key.length > 0;
  }
  return !Number.isNaN(Date.parse(key));
}
