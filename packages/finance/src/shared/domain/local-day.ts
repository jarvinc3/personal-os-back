import { fromZonedTime } from 'date-fns-tz';

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

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Clock time of `now` in the user's timezone, as `HH:mm:ss`. */
export function localTimeOfDay(timezone: string | null, now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone ?? 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(now);
}

export type LocalMomentInput = {
  timezone: string | null;
  /** Date the user picked: `YYYY-MM-DD`, or a full instant. */
  date: string | undefined;
  now: Date;
};

/**
 * Instant of a date the user picked, read in their timezone. A date-only value
 * keeps the chosen calendar day: it takes today's local clock time, so it never
 * slips into the previous day or month, and a value that already carries a time
 * (and zone) is respected as sent. Without a date, it is the current instant.
 */
export function resolveLocalMoment({
  timezone,
  date,
  now,
}: LocalMomentInput): Date {
  if (!date) {
    return now;
  }
  if (!DATE_ONLY_RE.test(date)) {
    return new Date(date);
  }
  const zone = timezone ?? 'UTC';
  return fromZonedTime(`${date}T${localTimeOfDay(timezone, now)}`, zone);
}
