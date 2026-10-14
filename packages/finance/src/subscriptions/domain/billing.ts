/**
 * Billing math for managed subscriptions. Every date is derived from the
 * anchor, never from the previous charge, so a month-end anchor keeps its day
 * (31 Jan → 28 Feb → 31 Mar). All math is UTC: the dates come from DATE
 * columns and must not shift with the server timezone.
 */

export const BILLING_CYCLES = [
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'YEARLY',
] as const;

export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** Charges of each cycle in a year, for the monthly/annual equivalent. */
export const PERIODS_PER_YEAR: Record<BillingCycle, number> = {
  WEEKLY: 52,
  MONTHLY: 12,
  QUARTERLY: 4,
  SEMIANNUAL: 2,
  YEARLY: 1,
};

const MS_PER_DAY = 86_400_000;

function utcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function addUtcMonths(date: Date, months: number): Date {
  const monthIndex = date.getUTCMonth() + months;
  const year = date.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function occurrence(anchor: Date, cycle: BillingCycle, steps: number): Date {
  switch (cycle) {
    case 'WEEKLY':
      return addUtcDays(anchor, steps * 7);
    case 'MONTHLY':
      return addUtcMonths(anchor, steps);
    case 'QUARTERLY':
      return addUtcMonths(anchor, steps * 3);
    case 'SEMIANNUAL':
      return addUtcMonths(anchor, steps * 6);
    case 'YEARLY':
      return addUtcMonths(anchor, steps * 12);
  }
}

export type BillingSchedule = {
  anchor: Date;
  cycle: BillingCycle;
  interval: number;
};

function assertInterval(interval: number): void {
  if (!Number.isInteger(interval) || interval < 1) {
    throw new Error(
      `billingInterval must be a positive integer, got ${interval}`,
    );
  }
}

/** First charge on or after `from`; when the anchor is future it is the anchor. */
export function firstBillingOnOrAfter(
  schedule: BillingSchedule,
  from: Date,
): Date {
  assertInterval(schedule.interval);
  const fromDay = utcDay(from);
  const anchor = utcDay(schedule.anchor);
  let step = 0;
  let candidate = anchor;
  while (candidate.getTime() < fromDay.getTime()) {
    step += 1;
    candidate = utcDay(
      occurrence(anchor, schedule.cycle, step * schedule.interval),
    );
  }
  return candidate;
}

/** First charge strictly after the given one, used after a payment lands. */
export function nextBillingAfter(
  schedule: BillingSchedule,
  current: Date,
): Date {
  return firstBillingOnOrAfter(schedule, addUtcDays(current, 1));
}

export function monthlyCost(input: {
  amount: number;
  cycle: BillingCycle;
  interval: number;
}): number {
  assertInterval(input.interval);
  return (input.amount * (PERIODS_PER_YEAR[input.cycle] / input.interval)) / 12;
}

export function annualCost(input: {
  amount: number;
  cycle: BillingCycle;
  interval: number;
}): number {
  assertInterval(input.interval);
  return input.amount * (PERIODS_PER_YEAR[input.cycle] / input.interval);
}

export function daysUntil(target: Date, today: Date): number {
  return Math.round(
    (utcDay(target).getTime() - utcDay(today).getTime()) / MS_PER_DAY,
  );
}

/**
 * Every charge the schedule lands inside `[from, to]`, both inclusive. A weekly
 * cycle returns several dates in a 30-day window; each is derived from the
 * anchor, not from the previous one.
 */
export function billingOccurrencesInRange(
  schedule: BillingSchedule,
  from: Date,
  to: Date,
): Date[] {
  assertInterval(schedule.interval);
  const end = utcDay(to);
  const occurrences: Date[] = [];
  let current = firstBillingOnOrAfter(schedule, from);
  while (current.getTime() <= end.getTime()) {
    occurrences.push(current);
    current = nextBillingAfter(schedule, current);
  }
  return occurrences;
}
