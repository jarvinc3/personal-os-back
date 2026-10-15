import {
  annualAmount,
  daysUntil,
  hasPriceIncrease,
  isChargeMissed,
  monthlyAmount,
  priceIncreasePct,
  upcomingPatterns,
} from './recurring-alerts';

describe('price increase', () => {
  it('flags a rise above the tolerance', () => {
    expect(
      hasPriceIncrease({ lastAmount: 111, avgAmount: 100, tolerancePct: 10 }),
    ).toBe(true);
    expect(
      hasPriceIncrease({ lastAmount: 110, avgAmount: 100, tolerancePct: 10 }),
    ).toBe(false);
  });

  it('computes the increase percentage', () => {
    expect(priceIncreasePct(120, 100)).toBeCloseTo(20, 5);
  });
});

describe('missed charge', () => {
  const today = new Date(Date.UTC(2026, 5, 10));

  it('is not missed inside the tolerance', () => {
    expect(
      isChargeMissed({
        nextExpectedDate: new Date(Date.UTC(2026, 5, 5)),
        today,
      }),
    ).toBe(false);
  });

  it('is missed once the tolerance passes', () => {
    expect(
      isChargeMissed({
        nextExpectedDate: new Date(Date.UTC(2026, 5, 4)),
        today,
      }),
    ).toBe(true);
  });
});

describe('equivalents', () => {
  it('turns a monthly charge into its annual cost', () => {
    expect(monthlyAmount(500, 30).toFixed(2)).toBe('500.00');
    expect(annualAmount(500, 30).toFixed(2)).toBe('6083.33');
  });

  it('turns an annual charge into its monthly cost', () => {
    expect(annualAmount(1200, 365).toFixed(2)).toBe('1200.00');
    expect(monthlyAmount(1200, 365).toFixed(2)).toBe('98.63');
  });

  it('rounds a half cent to the even cent (ROUND_HALF_EVEN)', () => {
    expect(annualAmount('0.125', 365).toFixed(2)).toBe('0.12');
  });

  it('reads the decimal strings the API returns', () => {
    expect(monthlyAmount('99.99', 30).toFixed(2)).toBe('99.99');
  });
});

describe('upcomingPatterns', () => {
  const today = new Date(Date.UTC(2026, 5, 10));

  it('keeps the window and sorts by days left', () => {
    const upcoming = upcomingPatterns(
      [
        { id: 'later', nextExpectedDate: new Date(Date.UTC(2026, 5, 25)) },
        { id: 'soon', nextExpectedDate: new Date(Date.UTC(2026, 5, 12)) },
        { id: 'past', nextExpectedDate: new Date(Date.UTC(2026, 5, 1)) },
      ],
      { today, days: 30 },
    );

    expect(upcoming.map((entry) => entry.pattern.id)).toEqual([
      'soon',
      'later',
    ]);
    expect(upcoming[0].daysUntil).toBe(2);
  });

  it('reports whole days until a date', () => {
    expect(daysUntil(new Date(Date.UTC(2026, 5, 12)), today)).toBe(2);
  });
});
