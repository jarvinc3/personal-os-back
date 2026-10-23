const DAY_MS = 24 * 60 * 60 * 1000;

export const BUDGET_PERIOD_TYPE = {
  MONTHLY: 'MONTHLY',
  BIWEEKLY: 'BIWEEKLY',
  CUSTOM: 'CUSTOM',
} as const;

export type BudgetPeriodType =
  (typeof BUDGET_PERIOD_TYPE)[keyof typeof BUDGET_PERIOD_TYPE];

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Shift by whole months in UTC, clamping the day to the target month. */
function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(year, month + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      Math.min(day, lastDay),
    ),
  );
}

/** The period right after `periodEnd`, by period type. */
export function nextBudgetPeriod(input: {
  periodType: BudgetPeriodType;
  periodStart: Date;
  periodEnd: Date;
}): { periodStart: Date; periodEnd: Date } {
  if (input.periodType === BUDGET_PERIOD_TYPE.MONTHLY) {
    return {
      periodStart: addMonths(input.periodStart, 1),
      periodEnd: addMonths(input.periodEnd, 1),
    };
  }
  if (input.periodType === BUDGET_PERIOD_TYPE.BIWEEKLY) {
    return {
      periodStart: addDays(input.periodStart, 14),
      periodEnd: addDays(input.periodEnd, 14),
    };
  }
  const lengthDays =
    Math.round(
      (input.periodEnd.getTime() - input.periodStart.getTime()) / DAY_MS,
    ) + 1;
  const periodStart = addDays(input.periodEnd, 1);
  return {
    periodStart,
    periodEnd: addDays(periodStart, Math.max(1, lengthDays) - 1),
  };
}
