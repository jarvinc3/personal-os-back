import {
  BANK_STATUS_CONFIDENCE_THRESHOLD,
  mapBankStatusToInternal,
  statusAffectsLedger,
} from './transaction-status';

describe('transaction-status domain', () => {
  it('maps APPROVED with high confidence to CONFIRMED', () => {
    expect(
      mapBankStatusToInternal({
        bankStatusNormalized: 'APPROVED',
        statusConfidence: 0.95,
      }),
    ).toBe('CONFIRMED');
  });

  it('falls back to PENDING on low confidence', () => {
    expect(
      mapBankStatusToInternal({
        bankStatusNormalized: 'APPROVED',
        statusConfidence: BANK_STATUS_CONFIDENCE_THRESHOLD - 0.01,
      }),
    ).toBe('PENDING');
  });

  it('falls back to PENDING on UNKNOWN bank status', () => {
    expect(
      mapBankStatusToInternal({
        bankStatusNormalized: 'UNKNOWN',
        statusConfidence: 0.95,
      }),
    ).toBe('PENDING');
  });

  it('maps declined family to DECLINED', () => {
    expect(
      mapBankStatusToInternal({
        bankStatusNormalized: 'REJECTED',
        statusConfidence: 0.9,
      }),
    ).toBe('DECLINED');
  });

  it('maps reverse family to REVERSED', () => {
    expect(
      mapBankStatusToInternal({
        bankStatusNormalized: 'REFUND',
        statusConfidence: 0.9,
      } as never),
    ).toBe('PENDING');
    expect(
      mapBankStatusToInternal({
        bankStatusNormalized: 'REFUNDED',
        statusConfidence: 0.9,
      }),
    ).toBe('REVERSED');
  });

  it('only CONFIRMED affects ledger', () => {
    expect(statusAffectsLedger('CONFIRMED')).toBe(true);
    expect(statusAffectsLedger('PENDING')).toBe(false);
    expect(statusAffectsLedger('DECLINED')).toBe(false);
  });
});
