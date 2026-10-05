import { normalizeCurrencyCode } from './money';

describe('normalizeCurrencyCode', () => {
  it('trims and uppercases ISO codes', () => {
    expect(normalizeCurrencyCode(' usd ')).toBe('USD');
  });

  it('maps the local Dominican spellings to DOP', () => {
    expect(normalizeCurrencyCode('RDS')).toBe('DOP');
    expect(normalizeCurrencyCode('rd$')).toBe('DOP');
  });

  it('leaves other codes untouched', () => {
    expect(normalizeCurrencyCode('EUR')).toBe('EUR');
  });
});
