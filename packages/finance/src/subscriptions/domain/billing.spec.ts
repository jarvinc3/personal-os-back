import {
  annualCost,
  billingOccurrencesInRange,
  firstBillingOnOrAfter,
  monthlyCost,
  nextBillingAfter,
} from './billing';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('firstBillingOnOrAfter', () => {
  it('keeps the anchor day across month ends', () => {
    const schedule = {
      anchor: day('2026-01-31'),
      cycle: 'MONTHLY' as const,
      interval: 1,
    };
    expect(
      firstBillingOnOrAfter(schedule, day('2026-02-01')).toISOString(),
    ).toBe('2026-02-28T00:00:00.000Z');
    expect(
      firstBillingOnOrAfter(schedule, day('2026-03-01')).toISOString(),
    ).toBe('2026-03-31T00:00:00.000Z');
  });

  it('returns the anchor itself when it is today', () => {
    const schedule = {
      anchor: day('2026-01-15'),
      cycle: 'MONTHLY' as const,
      interval: 1,
    };
    expect(
      firstBillingOnOrAfter(schedule, day('2026-01-15')).toISOString(),
    ).toBe('2026-01-15T00:00:00.000Z');
  });

  it('multiplies the cycle by the interval', () => {
    const schedule = {
      anchor: day('2026-01-15'),
      cycle: 'MONTHLY' as const,
      interval: 2,
    };
    expect(
      firstBillingOnOrAfter(schedule, day('2026-04-01')).toISOString(),
    ).toBe('2026-05-15T00:00:00.000Z');
  });
});

describe('nextBillingAfter', () => {
  it('advances to the following occurrence', () => {
    const schedule = {
      anchor: day('2026-01-31'),
      cycle: 'MONTHLY' as const,
      interval: 1,
    };
    expect(nextBillingAfter(schedule, day('2026-02-28')).toISOString()).toBe(
      '2026-03-31T00:00:00.000Z',
    );
  });

  it('handles a leap-day anchor', () => {
    const schedule = {
      anchor: day('2024-02-29'),
      cycle: 'YEARLY' as const,
      interval: 1,
    };
    expect(nextBillingAfter(schedule, day('2024-02-29')).toISOString()).toBe(
      '2025-02-28T00:00:00.000Z',
    );
  });
});

describe('monthlyCost and annualCost', () => {
  it('converts a monthly charge', () => {
    expect(
      monthlyCost({ amount: 10, cycle: 'MONTHLY', interval: 1 }).toFixed(2),
    ).toBe('10.00');
    expect(
      annualCost({ amount: 10, cycle: 'MONTHLY', interval: 1 }).toFixed(2),
    ).toBe('120.00');
  });

  it('honours the interval and the cycle', () => {
    expect(
      monthlyCost({ amount: 120, cycle: 'YEARLY', interval: 1 }).toFixed(2),
    ).toBe('10.00');
    expect(
      monthlyCost({ amount: 30, cycle: 'QUARTERLY', interval: 1 }).toFixed(2),
    ).toBe('10.00');
    expect(
      monthlyCost({ amount: 20, cycle: 'MONTHLY', interval: 2 }).toFixed(2),
    ).toBe('10.00');
  });
});

describe('billingOccurrencesInRange', () => {
  it('returns every weekly charge inside the window', () => {
    const occurrences = billingOccurrencesInRange(
      { anchor: day('2026-10-01'), cycle: 'WEEKLY', interval: 1 },
      day('2026-10-01'),
      day('2026-10-31'),
    );

    expect(occurrences.map((date) => date.toISOString().slice(0, 10))).toEqual([
      '2026-10-01',
      '2026-10-08',
      '2026-10-15',
      '2026-10-22',
      '2026-10-29',
    ]);
  });

  it('clips to the window for a monthly cycle', () => {
    const occurrences = billingOccurrencesInRange(
      { anchor: day('2026-01-31'), cycle: 'MONTHLY', interval: 1 },
      day('2026-02-01'),
      day('2026-03-31'),
    );

    expect(occurrences.map((date) => date.toISOString().slice(0, 10))).toEqual([
      '2026-02-28',
      '2026-03-31',
    ]);
  });
});
