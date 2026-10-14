import type { BillingCycle } from './billing';
import { daysUntil } from './billing';

/**
 * Alerts the Suscripciones view shows. Each one carries a stable `date` so a
 * dismissal sticks for that occurrence and the alert can come back next cycle.
 */
export const SUBSCRIPTION_ALERT_KINDS = [
  'PRICE_INCREASE',
  'TRIAL_ENDING',
  'ANNUAL_RENEWAL',
  'MISSED_CHARGE',
] as const;

export type SubscriptionAlertKind = (typeof SUBSCRIPTION_ALERT_KINDS)[number];

/** A charge more than this many days late and unpaid counts as missed. */
export const MISSED_CHARGE_GRACE_DAYS = 3;

/** Cycles long enough that the yearly renewal is worth a heads-up. */
const ANNUAL_RENEWAL_CYCLES: BillingCycle[] = ['YEARLY', 'SEMIANNUAL'];

export type SubscriptionAlert = {
  id: string;
  kind: SubscriptionAlertKind;
  subscriptionId: string;
  subscriptionName: string;
  /** ISO date (`YYYY-MM-DD`) the alert is about; the dismissal key. */
  date: string;
  currency: string;
  amount: string | null;
  previousAmount: string | null;
  /** Increase over the previous charge, rounded to one decimal. */
  percent: number | null;
  /** Days to the event (trial end or renewal); null when not a countdown. */
  daysUntil: number | null;
};

export type SubscriptionAlertFact = {
  id: string;
  name: string;
  currency: string;
  billingCycle: BillingCycle;
  amount: number;
  nextBillingDate: Date;
  trialEndsAt: Date | null;
  reminderDaysBefore: number;
  /** Last two payments, newest first, used for the price increase. */
  lastPaymentAmount: number | null;
  lastPaymentDate: Date | null;
  previousPaymentAmount: number | null;
  /** Whether a payment landed on or after `nextBillingDate`. */
  paidSinceNextBilling: boolean;
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function alertId(
  kind: SubscriptionAlertKind,
  subscriptionId: string,
  date: Date,
): string {
  return `${kind}:${subscriptionId}:${isoDate(date)}`;
}

function priceIncrease(fact: SubscriptionAlertFact): SubscriptionAlert | null {
  if (
    fact.lastPaymentAmount === null ||
    fact.previousPaymentAmount === null ||
    fact.previousPaymentAmount <= 0 ||
    fact.lastPaymentAmount <= fact.previousPaymentAmount ||
    fact.lastPaymentDate === null
  ) {
    return null;
  }
  const percent =
    Math.round(
      ((fact.lastPaymentAmount - fact.previousPaymentAmount) /
        fact.previousPaymentAmount) *
        1000,
    ) / 10;
  return {
    id: alertId('PRICE_INCREASE', fact.id, fact.lastPaymentDate),
    kind: 'PRICE_INCREASE',
    subscriptionId: fact.id,
    subscriptionName: fact.name,
    date: isoDate(fact.lastPaymentDate),
    currency: fact.currency,
    amount: fact.lastPaymentAmount.toFixed(2),
    previousAmount: fact.previousPaymentAmount.toFixed(2),
    percent,
    daysUntil: null,
  };
}

function trialEnding(
  fact: SubscriptionAlertFact,
  now: Date,
): SubscriptionAlert | null {
  if (fact.trialEndsAt === null) {
    return null;
  }
  const remaining = daysUntil(fact.trialEndsAt, now);
  if (remaining < 0 || remaining > fact.reminderDaysBefore) {
    return null;
  }
  return {
    id: alertId('TRIAL_ENDING', fact.id, fact.trialEndsAt),
    kind: 'TRIAL_ENDING',
    subscriptionId: fact.id,
    subscriptionName: fact.name,
    date: isoDate(fact.trialEndsAt),
    currency: fact.currency,
    amount: fact.amount.toFixed(2),
    previousAmount: null,
    percent: null,
    daysUntil: remaining,
  };
}

function annualRenewal(
  fact: SubscriptionAlertFact,
  now: Date,
): SubscriptionAlert | null {
  if (!ANNUAL_RENEWAL_CYCLES.includes(fact.billingCycle)) {
    return null;
  }
  const remaining = daysUntil(fact.nextBillingDate, now);
  if (remaining < 0 || remaining > fact.reminderDaysBefore) {
    return null;
  }
  return {
    id: alertId('ANNUAL_RENEWAL', fact.id, fact.nextBillingDate),
    kind: 'ANNUAL_RENEWAL',
    subscriptionId: fact.id,
    subscriptionName: fact.name,
    date: isoDate(fact.nextBillingDate),
    currency: fact.currency,
    amount: fact.amount.toFixed(2),
    previousAmount: null,
    percent: null,
    daysUntil: remaining,
  };
}

function missedCharge(
  fact: SubscriptionAlertFact,
  now: Date,
): SubscriptionAlert | null {
  if (fact.paidSinceNextBilling) {
    return null;
  }
  const overdueDays = -daysUntil(fact.nextBillingDate, now);
  if (overdueDays <= MISSED_CHARGE_GRACE_DAYS) {
    return null;
  }
  return {
    id: alertId('MISSED_CHARGE', fact.id, fact.nextBillingDate),
    kind: 'MISSED_CHARGE',
    subscriptionId: fact.id,
    subscriptionName: fact.name,
    date: isoDate(fact.nextBillingDate),
    currency: fact.currency,
    amount: fact.amount.toFixed(2),
    previousAmount: null,
    percent: null,
    daysUntil: -overdueDays,
  };
}

export function buildSubscriptionAlerts(
  fact: SubscriptionAlertFact,
  now: Date,
): SubscriptionAlert[] {
  return [
    priceIncrease(fact),
    trialEnding(fact, now),
    annualRenewal(fact, now),
    missedCharge(fact, now),
  ].filter((alert): alert is SubscriptionAlert => alert !== null);
}
