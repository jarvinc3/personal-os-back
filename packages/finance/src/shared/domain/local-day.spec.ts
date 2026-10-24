import { localDateIso, localTimeOfDay, resolveLocalMoment } from './local-day';

const SANTO_DOMINGO = 'America/Santo_Domingo';

describe('resolveLocalMoment', () => {
  it('keeps today when the chosen date is today, with the current local time', () => {
    // 2026-10-23 20:00 in Santo Domingo (UTC-4).
    const now = new Date('2026-10-24T00:00:00.000Z');

    const moment = resolveLocalMoment({
      timezone: SANTO_DOMINGO,
      date: '2026-10-23',
      now,
    });

    expect(localDateIso(SANTO_DOMINGO, moment)).toBe('2026-10-23');
    expect(moment.toISOString()).toBe('2026-10-24T00:00:00.000Z');
  });

  it('keeps a past date in its local day instead of the previous one', () => {
    const now = new Date('2026-10-24T00:00:00.000Z');

    const moment = resolveLocalMoment({
      timezone: SANTO_DOMINGO,
      date: '2026-09-30',
      now,
    });

    expect(localDateIso(SANTO_DOMINGO, moment)).toBe('2026-09-30');
    expect(moment.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('closes the month in the local calendar, not in UTC', () => {
    // 2026-10-31 23:30 in Santo Domingo.
    const now = new Date('2026-11-01T03:30:00.000Z');

    const moment = resolveLocalMoment({
      timezone: SANTO_DOMINGO,
      date: '2026-10-31',
      now,
    });

    expect(localDateIso(SANTO_DOMINGO, moment)).toBe('2026-10-31');
    expect(localDateIso(SANTO_DOMINGO, moment).slice(0, 7)).toBe('2026-10');
  });

  it('respects a value that already carries a time and zone', () => {
    const now = new Date('2026-10-24T00:00:00.000Z');

    const moment = resolveLocalMoment({
      timezone: SANTO_DOMINGO,
      date: '2026-10-20T15:30:00.000Z',
      now,
    });

    expect(moment.toISOString()).toBe('2026-10-20T15:30:00.000Z');
  });

  it('falls back to the current instant without a date', () => {
    const now = new Date('2026-10-24T00:00:00.000Z');

    expect(
      resolveLocalMoment({ timezone: SANTO_DOMINGO, date: undefined, now }),
    ).toBe(now);
  });

  it('reads the day in UTC when the profile has no timezone', () => {
    const now = new Date('2026-10-24T00:00:00.000Z');

    const moment = resolveLocalMoment({
      timezone: null,
      date: '2026-10-23',
      now,
    });

    expect(moment.toISOString()).toBe('2026-10-23T00:00:00.000Z');
    expect(localDateIso(null, moment)).toBe('2026-10-23');
  });
});

describe('localTimeOfDay', () => {
  it('returns the local clock for the user', () => {
    expect(
      localTimeOfDay(SANTO_DOMINGO, new Date('2026-10-24T00:00:00.000Z')),
    ).toBe('20:00:00');
  });

  it('does not render midnight as 24', () => {
    expect(
      localTimeOfDay(SANTO_DOMINGO, new Date('2026-10-23T04:00:00.000Z')),
    ).toBe('00:00:00');
  });
});
