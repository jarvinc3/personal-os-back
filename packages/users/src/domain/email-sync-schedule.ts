export const EMAIL_SYNC_SCHEDULE_MODES = {
  INTERVAL: 'interval',
  TIMES: 'times',
} as const;

export type EmailSyncScheduleMode =
  (typeof EMAIL_SYNC_SCHEDULE_MODES)[keyof typeof EMAIL_SYNC_SCHEDULE_MODES];

export type EmailSyncSchedule =
  | { mode: 'interval'; everyMinutes: number }
  | { mode: 'times'; times: string[] };

export const MIN_EMAIL_SYNC_INTERVAL_MINUTES = 15;
export const MAX_EMAIL_SYNC_TIMES = 8;

export const DEFAULT_EMAIL_SYNC_SCHEDULE: EmailSyncSchedule = {
  mode: EMAIL_SYNC_SCHEDULE_MODES.INTERVAL,
  everyMinutes: 360,
};

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateEmailSyncSchedule(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'emailSync.schedule must be an object';
  }
  const schedule = value as {
    mode?: unknown;
    everyMinutes?: unknown;
    times?: unknown;
  };
  if (schedule.mode === EMAIL_SYNC_SCHEDULE_MODES.INTERVAL) {
    if (
      typeof schedule.everyMinutes !== 'number' ||
      !Number.isInteger(schedule.everyMinutes) ||
      schedule.everyMinutes < MIN_EMAIL_SYNC_INTERVAL_MINUTES
    ) {
      return `emailSync.schedule.everyMinutes must be an integer >= ${MIN_EMAIL_SYNC_INTERVAL_MINUTES}`;
    }
    return null;
  }
  if (schedule.mode === EMAIL_SYNC_SCHEDULE_MODES.TIMES) {
    if (
      !Array.isArray(schedule.times) ||
      schedule.times.length === 0 ||
      schedule.times.length > MAX_EMAIL_SYNC_TIMES
    ) {
      return `emailSync.schedule.times must have 1 to ${MAX_EMAIL_SYNC_TIMES} entries`;
    }
    const hasInvalidEntry = schedule.times.some(
      (time) => typeof time !== 'string' || !TIME_OF_DAY_PATTERN.test(time),
    );
    if (hasInvalidEntry) {
      return 'emailSync.schedule.times entries must use HH:MM';
    }
    if (new Set(schedule.times).size !== schedule.times.length) {
      return 'emailSync.schedule.times entries must be unique';
    }
    return null;
  }
  return 'emailSync.schedule.mode must be "interval" or "times"';
}

export function parseEmailSyncSchedule(
  value: unknown,
): EmailSyncSchedule | null {
  if (validateEmailSyncSchedule(value) !== null) {
    return null;
  }
  return value as EmailSyncSchedule;
}
