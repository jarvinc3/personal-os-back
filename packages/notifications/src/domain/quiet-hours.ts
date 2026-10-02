export type QuietHoursInput = {
  enabled: boolean;
  start: string;
  end: string;
  timezone?: string | null;
  now?: Date;
};

function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function getMinutesInTimezone(
  date: Date,
  timezone: string | null | undefined,
): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone ?? undefined,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return hour * 60 + minute;
  } catch {
    return date.getHours() * 60 + date.getMinutes();
  }
}

export function isWithinQuietHours(input: QuietHoursInput): boolean {
  if (!input.enabled) {
    return false;
  }

  const start = parseTimeToMinutes(input.start);
  const end = parseTimeToMinutes(input.end);
  if (start === null || end === null) {
    return false;
  }

  const now = input.now ?? new Date();
  const current = getMinutesInTimezone(now, input.timezone);

  if (start === end) {
    return true;
  }

  if (start < end) {
    return current >= start && current < end;
  }

  return current >= start || current < end;
}
