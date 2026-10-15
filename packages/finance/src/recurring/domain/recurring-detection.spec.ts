import {
  detectRecurringPattern,
  type MerchantCharge,
} from './recurring-detection';

function charge(day: number, amount: number): MerchantCharge {
  return {
    id: `tx-${day}`,
    amount,
    date: new Date(Date.UTC(2026, 0, day)),
  };
}

describe('detectRecurringPattern', () => {
  it('detects three monthly charges of Netflix as a subscription', () => {
    const detected = detectRecurringPattern({
      merchantId: 'netflix',
      merchantName: 'Netflix',
      currency: 'DOP',
      charges: [charge(1, 500), charge(31, 500), charge(61, 505)],
      today: new Date(Date.UTC(2026, 2, 10)),
    });

    expect(detected).not.toBeNull();
    expect(detected?.frequency).toBe(30);
    expect(detected?.occurrences).toBe(3);
    expect(detected?.avgAmount).toBeCloseTo(501.67, 2);
    expect(detected?.nextExpectedDate.toISOString().slice(0, 10)).toBe(
      '2026-04-01',
    );
  });

  it('rejects charges outside the amount tolerance', () => {
    const detected = detectRecurringPattern({
      merchantId: 'merchant',
      merchantName: 'Merchant',
      currency: 'DOP',
      charges: [charge(1, 500), charge(31, 500), charge(61, 900)],
      today: new Date(Date.UTC(2026, 2, 10)),
    });

    expect(detected).toBeNull();
  });

  it('rejects a gap that matches no periodicity', () => {
    const detected = detectRecurringPattern({
      merchantId: 'merchant',
      merchantName: 'Merchant',
      currency: 'DOP',
      charges: [charge(1, 500), charge(46, 500), charge(91, 500)],
      today: new Date(Date.UTC(2026, 4, 10)),
    });

    expect(detected).toBeNull();
  });

  it('detects a weekly pattern', () => {
    const detected = detectRecurringPattern({
      merchantId: 'merchant',
      merchantName: 'Merchant',
      currency: 'DOP',
      charges: [
        charge(1, 100),
        charge(8, 100),
        charge(15, 100),
        charge(22, 100),
      ],
      today: new Date(Date.UTC(2026, 0, 30)),
    });

    expect(detected?.frequency).toBe(7);
    expect(detected?.occurrences).toBe(4);
  });

  it('needs three charges by default', () => {
    const detected = detectRecurringPattern({
      merchantId: 'merchant',
      merchantName: 'Merchant',
      currency: 'DOP',
      charges: [charge(1, 100), charge(31, 100)],
      today: new Date(Date.UTC(2026, 1, 10)),
    });

    expect(detected).toBeNull();
  });

  it('accepts two annual charges when the user already confirmed', () => {
    const detected = detectRecurringPattern({
      merchantId: 'merchant',
      merchantName: 'Merchant',
      currency: 'DOP',
      charges: [charge(1, 100), charge(366, 100)],
      today: new Date(Date.UTC(2027, 1, 10)),
      allowTwoOccurrences: true,
    });

    expect(detected?.frequency).toBe(365);
  });

  it('does not accept two monthly charges even when confirmed', () => {
    const detected = detectRecurringPattern({
      merchantId: 'merchant',
      merchantName: 'Merchant',
      currency: 'DOP',
      charges: [charge(1, 100), charge(31, 100)],
      today: new Date(Date.UTC(2026, 1, 10)),
      allowTwoOccurrences: true,
    });

    expect(detected).toBeNull();
  });

  it('lowers confidence when the gaps drift', () => {
    const tight = detectRecurringPattern({
      merchantId: 'merchant',
      merchantName: 'Merchant',
      currency: 'DOP',
      charges: [charge(1, 100), charge(31, 100), charge(61, 100)],
      today: new Date(Date.UTC(2026, 2, 10)),
    });
    const loose = detectRecurringPattern({
      merchantId: 'merchant',
      merchantName: 'Merchant',
      currency: 'DOP',
      charges: [charge(1, 100), charge(34, 100), charge(61, 100)],
      today: new Date(Date.UTC(2026, 2, 10)),
    });

    expect(tight?.confidenceScore).toBeGreaterThan(loose?.confidenceScore ?? 0);
  });
});
