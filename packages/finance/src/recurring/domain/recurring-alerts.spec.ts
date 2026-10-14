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
    expect(monthlyAmount(500, 30)).toBeCloseTo(500, 5);
    expect(annualAmount(500, 30)).toBeCloseTo(6083.33, 2);
  });

  it('turns an annual charge into its monthly cost', () => {
    expect(annualAmount(1200, 365)).toBeCloseTo(1200, 5);
    expect(monthlyAmount(1200, 365)).toBeCloseTo(98.63, 2);
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
