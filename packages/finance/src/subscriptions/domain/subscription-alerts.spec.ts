import {
  buildSubscriptionAlerts,
  type SubscriptionAlertFact,
} from './subscription-alerts';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function fact(
  overrides: Partial<SubscriptionAlertFact> = {},
): SubscriptionAlertFact {
  return {
    id: 'sub-1',
    name: 'Netflix',
    currency: 'DOP',
    billingCycle: 'MONTHLY',
    amount: 100,
    nextBillingDate: day('2026-11-10'),
    trialEndsAt: null,
    reminderDaysBefore: 3,
    lastPaymentAmount: null,
    lastPaymentDate: null,
    previousPaymentAmount: null,
    paidSinceNextBilling: false,
    ...overrides,
  };
}

describe('buildSubscriptionAlerts', () => {
  it('reports a price increase with the percentage over the previous charge', () => {
    const alerts = buildSubscriptionAlerts(
      fact({
        amount: 111,
        lastPaymentAmount: 111,
        lastPaymentDate: day('2026-10-28'),
        previousPaymentAmount: 100,
      }),
      day('2026-10-28'),
    );

    const increase = alerts.find((alert) => alert.kind === 'PRICE_INCREASE');
    expect(increase).toMatchObject({
      id: 'PRICE_INCREASE:sub-1:2026-10-28',
      amount: '111.00',
      previousAmount: '100.00',
      percent: 11,
      date: '2026-10-28',
    });
  });

  it('does not report a price increase when the charge did not go up', () => {
    const alerts = buildSubscriptionAlerts(
      fact({
        lastPaymentAmount: 100,
        lastPaymentDate: day('2026-10-28'),
        previousPaymentAmount: 100,
      }),
      day('2026-10-28'),
    );

    expect(alerts).toHaveLength(0);
  });

  it('reports a trial ending inside the reminder window and not before', () => {
    const inside = buildSubscriptionAlerts(
      fact({ trialEndsAt: day('2026-10-30'), reminderDaysBefore: 3 }),
      day('2026-10-28'),
    );
    expect(inside.map((alert) => alert.kind)).toContain('TRIAL_ENDING');
    expect(
      inside.find((alert) => alert.kind === 'TRIAL_ENDING')?.daysUntil,
    ).toBe(2);

    const outside = buildSubscriptionAlerts(
      fact({ trialEndsAt: day('2026-11-30'), reminderDaysBefore: 3 }),
      day('2026-10-28'),
    );
    expect(outside.map((alert) => alert.kind)).not.toContain('TRIAL_ENDING');
  });

  it('reports an upcoming annual renewal only for long cycles', () => {
    const yearly = buildSubscriptionAlerts(
      fact({
        billingCycle: 'YEARLY',
        nextBillingDate: day('2026-10-30'),
        reminderDaysBefore: 5,
      }),
      day('2026-10-28'),
    );
    expect(yearly.map((alert) => alert.kind)).toContain('ANNUAL_RENEWAL');

    const monthly = buildSubscriptionAlerts(
      fact({
        billingCycle: 'MONTHLY',
        nextBillingDate: day('2026-10-30'),
        reminderDaysBefore: 5,
      }),
      day('2026-10-28'),
    );
    expect(monthly.map((alert) => alert.kind)).not.toContain('ANNUAL_RENEWAL');
  });

  it('reports a missed charge after the grace period only', () => {
    const missed = buildSubscriptionAlerts(
      fact({ nextBillingDate: day('2026-10-20'), paidSinceNextBilling: false }),
      day('2026-10-28'),
    );
    expect(missed.map((alert) => alert.kind)).toContain('MISSED_CHARGE');
    expect(missed.find((alert) => alert.kind === 'MISSED_CHARGE')?.id).toBe(
      'MISSED_CHARGE:sub-1:2026-10-20',
    );

    const withinGrace = buildSubscriptionAlerts(
      fact({ nextBillingDate: day('2026-10-26'), paidSinceNextBilling: false }),
      day('2026-10-28'),
    );
    expect(withinGrace.map((alert) => alert.kind)).not.toContain(
      'MISSED_CHARGE',
    );

    const paid = buildSubscriptionAlerts(
      fact({ nextBillingDate: day('2026-10-20'), paidSinceNextBilling: true }),
      day('2026-10-28'),
    );
    expect(paid.map((alert) => alert.kind)).not.toContain('MISSED_CHARGE');
  });
});
