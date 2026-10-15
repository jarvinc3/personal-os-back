import {
  DEFAULT_SUBSCRIPTION_SORT,
  isValidSubscriptionCursorKey,
  subscriptionCursorKey,
} from './subscription-list';

const row = {
  nextBillingDate: new Date('2026-11-10T00:00:00.000Z'),
  amount: '120.00',
  name: 'Netflix',
};

describe('subscriptionCursorKey', () => {
  it('keys the date order with the next billing date', () => {
    expect(subscriptionCursorKey({ ...row, sort: 'NEXT_DATE' })).toBe(
      '2026-11-10T00:00:00.000Z',
    );
    expect(DEFAULT_SUBSCRIPTION_SORT).toBe('NEXT_DATE');
  });

  it('keys the amount and name orders with their own column', () => {
    expect(subscriptionCursorKey({ ...row, sort: 'AMOUNT' })).toBe('120.00');
    expect(subscriptionCursorKey({ ...row, sort: 'NAME' })).toBe('Netflix');
  });
});

describe('isValidSubscriptionCursorKey', () => {
  it('accepts only amounts for the amount order', () => {
    expect(isValidSubscriptionCursorKey('AMOUNT', '120.00')).toBe(true);
    expect(isValidSubscriptionCursorKey('AMOUNT', '120')).toBe(true);
    expect(isValidSubscriptionCursorKey('AMOUNT', 'Netflix')).toBe(false);
    expect(isValidSubscriptionCursorKey('AMOUNT', '')).toBe(false);
  });

  it('accepts any non-empty name for the name order', () => {
    expect(isValidSubscriptionCursorKey('NAME', 'Spotify')).toBe(true);
    expect(isValidSubscriptionCursorKey('NAME', '')).toBe(false);
  });

  it('accepts only timestamps for the date order', () => {
    expect(
      isValidSubscriptionCursorKey('NEXT_DATE', '2026-11-10T00:00:00.000Z'),
    ).toBe(true);
    expect(isValidSubscriptionCursorKey('NEXT_DATE', '120.00')).toBe(false);
  });
});
