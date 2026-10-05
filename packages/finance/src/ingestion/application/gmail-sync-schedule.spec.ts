import { isEmailSyncDue } from './gmail-sync-schedule';

describe('isEmailSyncDue', () => {
  it('is due when the source never synced', () => {
    expect(
      isEmailSyncDue({
        lastSyncedAt: null,
        schedule: { mode: 'interval', everyMinutes: 360 },
        timezone: 'UTC',
        now: new Date('2026-09-22T12:00:00.000Z'),
      }),
    ).toBe(true);
  });

  it('uses the configured interval', () => {
    const now = new Date('2026-09-22T12:00:00.000Z');
    expect(
      isEmailSyncDue({
        lastSyncedAt: new Date('2026-09-22T11:50:00.000Z'),
        schedule: { mode: 'interval', everyMinutes: 15 },
        timezone: 'UTC',
        now,
      }),
    ).toBe(false);
    expect(
      isEmailSyncDue({
        lastSyncedAt: new Date('2026-09-22T11:44:00.000Z'),
        schedule: { mode: 'interval', everyMinutes: 15 },
        timezone: 'UTC',
        now,
      }),
    ).toBe(true);
  });

  it('uses the latest time of day already passed', () => {
    const now = new Date('2026-09-22T13:00:00.000Z');
    expect(
      isEmailSyncDue({
        lastSyncedAt: new Date('2026-09-22T11:59:00.000Z'),
        schedule: { mode: 'times', times: ['08:00', '12:00'] },
        timezone: 'UTC',
        now,
      }),
    ).toBe(true);
    expect(
      isEmailSyncDue({
        lastSyncedAt: new Date('2026-09-22T12:01:00.000Z'),
        schedule: { mode: 'times', times: ['08:00', '12:00'] },
        timezone: 'UTC',
        now,
      }),
    ).toBe(false);
  });

  it('falls back to the last time of the previous day', () => {
    const now = new Date('2026-09-22T11:00:00.000Z');
    const schedule = { mode: 'times' as const, times: ['08:00'] };
    const timezone = 'America/Santo_Domingo';
    expect(
      isEmailSyncDue({
        lastSyncedAt: new Date('2026-09-21T11:00:00.000Z'),
        schedule,
        timezone,
        now,
      }),
    ).toBe(true);
    expect(
      isEmailSyncDue({
        lastSyncedAt: new Date('2026-09-21T13:00:00.000Z'),
        schedule,
        timezone,
        now,
      }),
    ).toBe(false);
  });

  it('uses the previous local day just after midnight in the user timezone', () => {
    const schedule = { mode: 'times' as const, times: ['08:00'] };
    const timezone = 'America/Santo_Domingo';
    const now = new Date('2026-09-22T04:30:00.000Z');
    expect(
      isEmailSyncDue({
        lastSyncedAt: new Date('2026-09-21T11:00:00.000Z'),
        schedule,
        timezone,
        now,
      }),
    ).toBe(true);
    expect(
      isEmailSyncDue({
        lastSyncedAt: new Date('2026-09-21T13:00:00.000Z'),
        schedule,
        timezone,
        now,
      }),
    ).toBe(false);
  });

  it('uses the current local day late at night in the user timezone', () => {
    const schedule = { mode: 'times' as const, times: ['08:00'] };
    const timezone = 'America/Santo_Domingo';
    const now = new Date('2026-09-23T03:30:00.000Z');
    expect(
      isEmailSyncDue({
        lastSyncedAt: new Date('2026-09-22T11:00:00.000Z'),
        schedule,
        timezone,
        now,
      }),
    ).toBe(true);
    expect(
      isEmailSyncDue({
        lastSyncedAt: new Date('2026-09-22T13:00:00.000Z'),
        schedule,
        timezone,
        now,
      }),
    ).toBe(false);
  });
});
