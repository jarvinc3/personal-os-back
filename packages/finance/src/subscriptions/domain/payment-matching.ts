/**
 * Payment matching: a movement is a subscription charge when it shares the
 * normalized merchant, the currency, an amount within ±5 % and a date within
 * ±3 days of the expected next billing date. Pure: no DB, no clock.
 */

import { normalizeMerchant } from '../../merchants/domain/normalize-merchant';

export const MATCH_AMOUNT_TOLERANCE_PCT = 5;
export const MATCH_DATE_TOLERANCE_DAYS = 3;

const MS_PER_DAY = 86_400_000;

function utcDayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export type MatchableSubscription = {
  id: string;
  normalizedKey: string;
  amount: number;
  currency: string;
  nextBillingDate: Date;
};

export type MatchableTransaction = {
  merchant: string | null;
  amount: number;
  currency: string;
  transactionDate: Date;
};

export function matchesSubscription(input: {
  subscription: MatchableSubscription;
  transaction: MatchableTransaction;
}): boolean {
  const key = normalizeMerchant(input.transaction.merchant);
  if (!key || key !== input.subscription.normalizedKey) {
    return false;
  }
  if (
    input.transaction.currency.toUpperCase() !==
    input.subscription.currency.toUpperCase()
  ) {
    return false;
  }
  const tolerance =
    (input.subscription.amount * MATCH_AMOUNT_TOLERANCE_PCT) / 100;
  if (
    Math.abs(input.transaction.amount - input.subscription.amount) > tolerance
  ) {
    return false;
  }
  // Calendar days, not elapsed hours: a charge on the expected day at 23:00 is
  // still within that day.
  const dayGap = Math.abs(
    utcDayStart(input.transaction.transactionDate) -
      utcDayStart(input.subscription.nextBillingDate),
  );
  return dayGap / MS_PER_DAY <= MATCH_DATE_TOLERANCE_DAYS;
}
