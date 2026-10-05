import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import {
  EMAIL_SYNC_SCHEDULE_MODES,
  type EmailSyncSchedule,
} from '@personal-os/config';

const MINUTE_MS = 60_000;

/** Previous calendar day for a `yyyy-MM-dd` string, independent of process TZ. */
function previousCalendarDate(date: string): string {
  const utcDate = new Date(`${date}T00:00:00.000Z`);
  utcDate.setUTCDate(utcDate.getUTCDate() - 1);
  return utcDate.toISOString().slice(0, 10);
}

export function isEmailSyncDue(params: {
  lastSyncedAt: Date | null;
  schedule: EmailSyncSchedule;
  timezone: string;
  now: Date;
}): boolean {
  if (!params.lastSyncedAt) {
    return true;
  }
  if (params.schedule.mode === EMAIL_SYNC_SCHEDULE_MODES.INTERVAL) {
    const intervalMs = params.schedule.everyMinutes * MINUTE_MS;
    return params.now.getTime() - params.lastSyncedAt.getTime() >= intervalMs;
  }
  const latest = latestTimeOfDayOccurrence(
    params.schedule.times,
    params.timezone,
    params.now,
  );
  return latest !== null && params.lastSyncedAt.getTime() < latest.getTime();
}

function latestTimeOfDayOccurrence(
  times: string[],
  timezone: string,
  now: Date,
): Date | null {
  const today = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  const todayOccurrences = times
    .map((time) => fromZonedTime(`${today}T${time}:00`, timezone))
    .filter((occurrence) => occurrence.getTime() <= now.getTime());
  if (todayOccurrences.length > 0) {
    return new Date(
      Math.max(...todayOccurrences.map((occurrence) => occurrence.getTime())),
    );
  }
  const yesterday = previousCalendarDate(today);
  const lastTime = [...times].sort()[times.length - 1];
  if (!lastTime) {
    return null;
  }
  return fromZonedTime(`${yesterday}T${lastTime}:00`, timezone);
}
