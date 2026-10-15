import { isValidIsoDate } from './iso-date';

describe('isValidIsoDate', () => {
  it('accepts real calendar dates', () => {
    expect(isValidIsoDate('2026-10-12')).toBe(true);
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true);
  });

  it('rejects impossible calendar dates', () => {
    expect(isValidIsoDate('2026-02-31')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-00-10')).toBe(false);
    expect(isValidIsoDate('2025-02-29')).toBe(false);
  });

  it('rejects other shapes', () => {
    expect(isValidIsoDate('')).toBe(false);
    expect(isValidIsoDate('2026-2-3')).toBe(false);
    expect(isValidIsoDate('20261012')).toBe(false);
    expect(isValidIsoDate('2026-10-12T00:00:00.000Z')).toBe(false);
  });
});
