/**
 * Derived figures and alerts for a recurring pattern: whether its last charge
 * went up, whether the next one is late, and its monthly/annual equivalent.
 */

import type { RecurringPeriodicity } from './recurring-detection';

const MS_PER_DAY = 86_400_000;
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;

/** Days the expected date may slip before the charge counts as missed. */
export const MISSED_TOLERANCE_DAYS = 5;
/** Days before the expected date an upcoming charge is announced. */
export const UPCOMING_REMINDER_DAYS = 3;
export const DEFAULT_UPCOMING_DAYS = 30;

export function daysUntil(target: Date, today: Date): number {
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
}

export function priceIncreasePct(
  lastAmount: number,
  avgAmount: number,
): number {
  if (avgAmount <= 0) {
    return 0;
  }
  return ((lastAmount - avgAmount) / avgAmount) * 100;
}

export function hasPriceIncrease(input: {
  lastAmount: number;
  avgAmount: number;
  tolerancePct: number;
}): boolean {
  return (
    priceIncreasePct(input.lastAmount, input.avgAmount) > input.tolerancePct
  );
}

export function isChargeMissed(input: {
  nextExpectedDate: Date;
  today: Date;
  toleranceDays?: number;
}): boolean {
  return (
    daysUntil(input.nextExpectedDate, input.today) <
    -(input.toleranceDays ?? MISSED_TOLERANCE_DAYS)
  );
}

export function monthlyAmount(
  amount: number,
  frequency: RecurringPeriodicity,
): number {
  return (amount * DAYS_PER_MONTH) / frequency;
}

export function annualAmount(
  amount: number,
  frequency: RecurringPeriodicity,
): number {
  return (amount * DAYS_PER_YEAR) / frequency;
}

export type UpcomingPattern<T> = {
  pattern: T;
  daysUntil: number;
};

/** Confirmed, not-missed patterns whose next charge falls inside the window. */
export function upcomingPatterns<T extends { nextExpectedDate: Date }>(
  patterns: T[],
  input: { today: Date; days: number },
): UpcomingPattern<T>[] {
  return patterns
    .map((pattern) => ({
      pattern,
      daysUntil: daysUntil(pattern.nextExpectedDate, input.today),
    }))
    .filter((entry) => entry.daysUntil >= 0 && entry.daysUntil <= input.days)
    .sort((left, right) => left.daysUntil - right.daysUntil);
}
