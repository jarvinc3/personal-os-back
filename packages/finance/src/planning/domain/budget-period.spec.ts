import { BUDGET_PERIOD_TYPE, nextBudgetPeriod } from './budget-period';

describe('nextBudgetPeriod', () => {
  it('moves a monthly window one month, clamping the day', () => {
    const next = nextBudgetPeriod({
      periodType: BUDGET_PERIOD_TYPE.MONTHLY,
      periodStart: new Date('2026-01-31T00:00:00.000Z'),
      periodEnd: new Date('2026-02-28T00:00:00.000Z'),
    });
    expect(next.periodStart.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(next.periodEnd.toISOString()).toBe('2026-03-28T00:00:00.000Z');
  });

  it('moves a biweekly window by 14 days', () => {
    const next = nextBudgetPeriod({
      periodType: BUDGET_PERIOD_TYPE.BIWEEKLY,
      periodStart: new Date('2026-10-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-14T00:00:00.000Z'),
    });
    expect(next.periodStart.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(next.periodEnd.toISOString()).toBe('2026-10-28T00:00:00.000Z');
  });

  it('keeps the length of a custom window', () => {
    const next = nextBudgetPeriod({
      periodType: BUDGET_PERIOD_TYPE.CUSTOM,
      periodStart: new Date('2026-10-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-10T00:00:00.000Z'),
    });
    expect(next.periodStart.toISOString()).toBe('2026-10-11T00:00:00.000Z');
    expect(next.periodEnd.toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });
});
