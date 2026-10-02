import { subDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import {
  EMAIL_SYNC_SCHEDULE_MODES,
  type EmailSyncSchedule,
} from '../../../users';

const MINUTE_MS = 60_000;

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
  const yesterday = subDays(new Date(`${today}T00:00:00.000Z`), 1)
    .toISOString()
    .slice(0, 10);
  const lastTime = [...times].sort()[times.length - 1];
  if (!lastTime) {
    return null;
  }
  return fromZonedTime(`${yesterday}T${lastTime}:00`, timezone);
}
