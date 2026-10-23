/**
 * Calendar date of `now` in the user's timezone, as `YYYY-MM-DD`. Falls back to
 * UTC when the profile has no timezone, the same convention as the schedulers.
 */
export function localDateIso(timezone: string | null, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone ?? 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Midnight UTC of the user's local calendar date, for date-only math. */
export function localDayStart(timezone: string | null, now: Date): Date {
  return new Date(`${localDateIso(timezone, now)}T00:00:00.000Z`);
}

/** `YYYY-MM-DD` of a date already normalized to UTC midnight. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Last millisecond of a stored date-only day, in UTC. */
export function endOfUtcDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
}
