import {
  convertDecimal,
  normalizeCurrencyCode,
  ratioPercent,
  roundDecimal,
  scalarNumber,
  sumMoney,
  toMoney,
} from './money';

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

describe('decimal money helpers', () => {
  it('sums decimals without the float error of 0.1 + 0.2', () => {
    expect(sumMoney([0.1, 0.2]).toString()).toBe('0.3');
  });

  it('converts a million to USD and keeps the cent', () => {
    expect(convertDecimal(1_000_000, 0.018123).toFixed(2)).toBe('18123.00');
  });

  it('rounds a half cent to the even cent (ROUND_HALF_EVEN)', () => {
    expect(roundDecimal('0.125').toString()).toBe('0.12');
    expect(roundDecimal('0.135').toString()).toBe('0.14');
  });

  it('reads the decimal strings the API returns', () => {
    expect(toMoney('145.63').toString()).toBe('145.63');
  });

  it('reads a missing amount as zero', () => {
    expect(toMoney(null).toString()).toBe('0');
    expect(toMoney(undefined).toString()).toBe('0');
  });

  it('computes a percentage from decimals and guards a zero base', () => {
    expect(ratioPercent(25, 100)).toBe(25);
    expect(ratioPercent(1, 0)).toBe(0);
  });

  it('reads a non-money decimal as a plain number', () => {
    expect(scalarNumber('80')).toBe(80);
  });
});
