import {
  isWeekStartsOn,
  readWeekStartsOnInput,
  validateWeekStartsOn,
  weekStartsOnFromLocale,
} from './week-starts-on';

describe('isWeekStartsOn', () => {
  it('accepts sunday, monday and saturday', () => {
    expect([0, 1, 6].every(isWeekStartsOn)).toBe(true);
  });

  it('rejects other weekdays and non numbers', () => {
    expect(isWeekStartsOn(2)).toBe(false);
    expect(isWeekStartsOn('1')).toBe(false);
    expect(isWeekStartsOn(null)).toBe(false);
  });
});

describe('weekStartsOnFromLocale', () => {
  it('reads the first day from the locale week info', () => {
    expect(weekStartsOnFromLocale('es-DO')).toBe(0);
    expect(weekStartsOnFromLocale('en-US')).toBe(0);
    expect(weekStartsOnFromLocale('es-ES')).toBe(1);
    expect(weekStartsOnFromLocale('ar-EG')).toBe(6);
  });

  it('rejects a malformed locale instead of guessing the day', () => {
    expect(() => weekStartsOnFromLocale('es_DO')).toThrow(/Invalid locale/);
    expect(() => weekStartsOnFromLocale('not a locale')).toThrow(
      /Invalid locale/,
    );
    expect(() => weekStartsOnFromLocale('')).toThrow(/Invalid locale/);
  });
});

describe('validateWeekStartsOn', () => {
  it('accepts the stored values and the automatic null', () => {
    expect(validateWeekStartsOn(undefined)).toBeNull();
    expect(validateWeekStartsOn(null)).toBeNull();
    expect(validateWeekStartsOn(0)).toBeNull();
    expect(validateWeekStartsOn(1)).toBeNull();
    expect(validateWeekStartsOn(6)).toBeNull();
  });

  it('rejects weekdays outside the supported set', () => {
    expect(validateWeekStartsOn(2)).toContain('regional.weekStartsOn');
    expect(validateWeekStartsOn('1')).toContain('regional.weekStartsOn');
    expect(validateWeekStartsOn(false)).toContain('regional.weekStartsOn');
  });
});

describe('readWeekStartsOnInput', () => {
  it('reads a nested value and tolerates missing shapes', () => {
    expect(readWeekStartsOnInput({ regional: { weekStartsOn: 0 } })).toBe(0);
    expect(readWeekStartsOnInput({ regional: {} })).toBeUndefined();
    expect(readWeekStartsOnInput({})).toBeUndefined();
    expect(readWeekStartsOnInput(null)).toBeUndefined();
    expect(readWeekStartsOnInput('regional')).toBeUndefined();
  });
});
