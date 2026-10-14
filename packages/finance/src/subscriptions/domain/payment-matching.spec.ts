import { matchesSubscription } from './payment-matching';

const subscription = {
  id: 'sub-1',
  normalizedKey: 'NETFLIX',
  amount: 100,
  currency: 'DOP',
  nextBillingDate: new Date('2026-05-10T00:00:00.000Z'),
};

describe('matchesSubscription', () => {
  it('matches the same merchant, currency, amount and date', () => {
    expect(
      matchesSubscription({
        subscription,
        transaction: {
          merchant: 'PAYPAL *NETFLIX 8821',
          amount: 103,
          currency: 'DOP',
          transactionDate: new Date('2026-05-12T12:00:00.000Z'),
        },
      }),
    ).toBe(true);
  });

  it('rejects an amount outside the 5 % band', () => {
    expect(
      matchesSubscription({
        subscription,
        transaction: {
          merchant: 'NETFLIX',
          amount: 106,
          currency: 'DOP',
          transactionDate: new Date('2026-05-10T00:00:00.000Z'),
        },
      }),
    ).toBe(false);
  });

  it('rejects a date outside the 3-day window', () => {
    expect(
      matchesSubscription({
        subscription,
        transaction: {
          merchant: 'NETFLIX',
          amount: 100,
          currency: 'DOP',
          transactionDate: new Date('2026-05-15T00:00:00.000Z'),
        },
      }),
    ).toBe(false);
  });

  it('rejects another merchant or currency', () => {
    expect(
      matchesSubscription({
        subscription,
        transaction: {
          merchant: 'SPOTIFY',
          amount: 100,
          currency: 'DOP',
          transactionDate: new Date('2026-05-10T00:00:00.000Z'),
        },
      }),
    ).toBe(false);
    expect(
      matchesSubscription({
        subscription,
        transaction: {
          merchant: 'NETFLIX',
          amount: 100,
          currency: 'USD',
          transactionDate: new Date('2026-05-10T00:00:00.000Z'),
        },
      }),
    ).toBe(false);
  });
});
