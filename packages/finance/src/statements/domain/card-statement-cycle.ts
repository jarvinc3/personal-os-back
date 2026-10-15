export const MIN_STATEMENT_DAY = 1;
export const MAX_STATEMENT_DAY = 31;

export type ClosedCardCycle = {
  /** Previous cycle closing; the cycle is the window (cycleStart, cycleEnd]. */
  cycleStart: Date;
  cycleEnd: Date;
};

export function isStatementDay(day: number | null | undefined): day is number {
  return (
    typeof day === 'number' &&
    Number.isInteger(day) &&
    day >= MIN_STATEMENT_DAY &&
    day <= MAX_STATEMENT_DAY
  );
}

export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function normalizeMonth(
  year: number,
  month: number,
): { year: number; month: number } {
  const zeroBased = month - 1;
  return {
    year: year + Math.floor(zeroBased / 12),
    month: (((zeroBased % 12) + 12) % 12) + 1,
  };
}

/** The statement day inside a month, clamped to that month's last day. */
export function statementDateOfMonth(
  year: number,
  month: number,
  day: number,
): Date {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, Math.min(day, lastDay)));
}

export function shiftStatementMonths(
  date: Date,
  day: number,
  months: number,
): Date {
  const shifted = normalizeMonth(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1 + months,
  );
  return statementDateOfMonth(shifted.year, shifted.month, day);
}

export function statementDateOnOrAfter(day: number, reference: Date): Date {
  const candidate = statementDateOfMonth(
    reference.getUTCFullYear(),
    reference.getUTCMonth() + 1,
    day,
  );
  if (candidate.getTime() >= reference.getTime()) {
    return candidate;
  }
  return shiftStatementMonths(candidate, day, 1);
}

/** Strictly after the closing date, so a due day equal to it moves one month. */
export function firstDueDateAfter(closingDate: Date, dueDay: number): Date {
  const candidate = statementDateOfMonth(
    closingDate.getUTCFullYear(),
    closingDate.getUTCMonth() + 1,
    dueDay,
  );
  if (candidate.getTime() > closingDate.getTime()) {
    return candidate;
  }
  return shiftStatementMonths(candidate, dueDay, 1);
}

export type NextCardCycle = {
  /** Closing date still ahead, or today. */
  statementDate: Date;
  /** Payment due date after that closing; null when the card has no due day. */
  paymentDueDate: Date | null;
};

/**
 * Closing still ahead (or today) and its due date. The caller passes the day it
 * considers today, so the projection follows the user's timezone.
 */
export function buildNextCardCycle(input: {
  closingDay: number | null | undefined;
  dueDay: number | null | undefined;
  today: Date;
}): NextCardCycle | null {
  const { closingDay, dueDay, today } = input;
  if (!isStatementDay(closingDay)) {
    return null;
  }
  const statementDate = statementDateOnOrAfter(closingDay, today);
  return {
    statementDate,
    paymentDueDate: isStatementDay(dueDay)
      ? firstDueDateAfter(statementDate, dueDay)
      : null,
  };
}

/**
 * Every billing cycle that has already closed, oldest first. A cycle counts as
 * closed only once its closing day is behind `today`, so an in-progress day
 * never produces a partial snapshot.
 */
export function buildClosedCardCycles(input: {
  closingDay: number;
  firstActivityDate: Date;
  today: Date;
}): ClosedCardCycle[] {
  const { closingDay, firstActivityDate, today } = input;
  const cycles: ClosedCardCycle[] = [];
  let cycleEnd = statementDateOnOrAfter(closingDay, firstActivityDate);
  while (cycleEnd.getTime() < today.getTime()) {
    cycles.push({
      cycleStart: shiftStatementMonths(cycleEnd, closingDay, -1),
      cycleEnd,
    });
    cycleEnd = shiftStatementMonths(cycleEnd, closingDay, 1);
  }
  return cycles;
}
