import { parseStrictEnvBoolean } from './parse-env-boolean';

describe('parseStrictEnvBoolean', () => {
  it('returns undefined for empty values', () => {
    expect(parseStrictEnvBoolean(undefined)).toBeUndefined();
    expect(parseStrictEnvBoolean(null)).toBeUndefined();
    expect(parseStrictEnvBoolean('')).toBeUndefined();
  });

  it('parses true variants', () => {
    expect(parseStrictEnvBoolean(true)).toBe(true);
    expect(parseStrictEnvBoolean('true')).toBe(true);
    expect(parseStrictEnvBoolean('TRUE')).toBe(true);
    expect(parseStrictEnvBoolean('1')).toBe(true);
    expect(parseStrictEnvBoolean(1)).toBe(true);
  });

  it('parses false variants including the string "false"', () => {
    expect(parseStrictEnvBoolean(false)).toBe(false);
    expect(parseStrictEnvBoolean('false')).toBe(false);
    expect(parseStrictEnvBoolean('FALSE')).toBe(false);
    expect(parseStrictEnvBoolean('0')).toBe(false);
    expect(parseStrictEnvBoolean(0)).toBe(false);
  });

  it('rejects invalid values', () => {
    expect(() => parseStrictEnvBoolean('yes')).toThrow(/must be true\/false\/1\/0/);
    expect(() => parseStrictEnvBoolean('2')).toThrow();
  });
});
