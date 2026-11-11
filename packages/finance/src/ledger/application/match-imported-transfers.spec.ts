import {
  isUnpairedTransferCandidate,
  pickTransferMatch,
  type ImportTransferCandidate,
} from './match-imported-transfers';

const DAY_MS = 24 * 60 * 60 * 1000;

function candidate(
  overrides: Partial<ImportTransferCandidate> &
    Pick<ImportTransferCandidate, 'id' | 'type'>,
): ImportTransferCandidate {
  return {
    amount: 1000,
    currency: 'DOP',
    transactionDate: new Date('2026-09-15T12:00:00.000Z'),
    transferGroupId: overrides.transferGroupId ?? 'solo',
    categoryId: null,
    description: overrides.description ?? 'Transferencia',
    merchant: null,
    notes: null,
    aiMetadata: {
      movementClass:
        overrides.type === 'DEBIT' ? 'TRANSFER_OUT' : 'TRANSFER_IN',
    },
    account: { institutionId: 'inst-a' },
    card: null,
    emailMessage: null,
    ...overrides,
  };
}

describe('pickTransferMatch', () => {
  it('pairs opposite legs of the same amount across institutions', () => {
    const debit = candidate({
      id: 'd1',
      type: 'DEBIT',
      account: { institutionId: 'bhd' },
    });
    const credit = candidate({
      id: 'c1',
      type: 'CREDIT',
      account: { institutionId: 'qik' },
    });
    expect(pickTransferMatch(debit, [debit, credit]).match?.id).toBe('c1');
  });

  it('leaves ambiguous same-amount candidates unmatched', () => {
    const debit = candidate({
      id: 'd1',
      type: 'DEBIT',
      account: { institutionId: 'bhd' },
    });
    const first = candidate({
      id: 'c1',
      type: 'CREDIT',
      account: { institutionId: 'qik' },
    });
    const second = candidate({
      id: 'c2',
      type: 'CREDIT',
      account: { institutionId: 'popular' },
    });
    const result = pickTransferMatch(debit, [debit, first, second]);
    expect(result.match).toBeNull();
    expect(result.candidateIds).toEqual(['c1', 'c2']);
  });

  it('does not treat ATM withdrawals as inter-bank transfers', () => {
    const atm = candidate({
      id: 'atm',
      type: 'DEBIT',
      description: 'Retiro en cajero',
      aiMetadata: { movementClass: 'ATM_WITHDRAWAL' },
      transferGroupId: null,
    });
    expect(isUnpairedTransferCandidate(atm, [atm])).toBe(false);
  });

  it('pairs legs five days apart when both share the bank reference', () => {
    const debit = candidate({
      id: 'd1',
      type: 'DEBIT',
      externalReference: 'REF-1',
      transactionDate: new Date('2026-09-10T12:00:00.000Z'),
      account: { institutionId: 'bhd' },
    });
    const credit = candidate({
      id: 'c1',
      type: 'CREDIT',
      externalReference: 'REF-1',
      transactionDate: new Date('2026-09-15T12:00:00.000Z'),
      account: { institutionId: 'qik' },
    });

    expect(pickTransferMatch(debit, [debit, credit]).match?.id).toBe('c1');
  });

  it('does not pair shared references beyond seven days', () => {
    const debit = candidate({
      id: 'd1',
      type: 'DEBIT',
      externalReference: 'REF-1',
      transactionDate: new Date('2026-09-01T12:00:00.000Z'),
      account: { institutionId: 'bhd' },
    });
    const credit = candidate({
      id: 'c1',
      type: 'CREDIT',
      externalReference: 'REF-1',
      transactionDate: new Date('2026-09-10T12:00:00.000Z'),
      account: { institutionId: 'qik' },
    });

    expect(pickTransferMatch(debit, [debit, credit]).match).toBeNull();
  });

  it('pairs at exactly seven days with the shared reference', () => {
    const debit = candidate({
      id: 'd1',
      type: 'DEBIT',
      externalReference: 'REF-1',
      transactionDate: new Date('2026-09-08T12:00:00.000Z'),
      account: { institutionId: 'bhd' },
    });
    const credit = candidate({
      id: 'c1',
      type: 'CREDIT',
      externalReference: 'REF-1',
      transactionDate: new Date(
        new Date('2026-09-08T12:00:00.000Z').getTime() + 7 * DAY_MS,
      ),
      account: { institutionId: 'qik' },
    });

    expect(pickTransferMatch(debit, [debit, credit]).match?.id).toBe('c1');
  });

  it('does not pair one millisecond beyond seven days', () => {
    const debit = candidate({
      id: 'd1',
      type: 'DEBIT',
      externalReference: 'REF-1',
      transactionDate: new Date('2026-09-08T12:00:00.000Z'),
      account: { institutionId: 'bhd' },
    });
    const credit = candidate({
      id: 'c1',
      type: 'CREDIT',
      externalReference: 'REF-1',
      transactionDate: new Date(
        new Date('2026-09-08T12:00:00.000Z').getTime() + 7 * DAY_MS + 1,
      ),
      account: { institutionId: 'qik' },
    });

    expect(pickTransferMatch(debit, [debit, credit]).match).toBeNull();
  });

  it('pairs at exactly three days without a shared reference', () => {
    const debit = candidate({
      id: 'd1',
      type: 'DEBIT',
      transactionDate: new Date('2026-09-12T12:00:00.000Z'),
      account: { institutionId: 'bhd' },
    });
    const credit = candidate({
      id: 'c1',
      type: 'CREDIT',
      transactionDate: new Date('2026-09-15T12:00:00.000Z'),
      account: { institutionId: 'qik' },
    });

    expect(pickTransferMatch(debit, [debit, credit]).match?.id).toBe('c1');
  });

  it('does not pair one millisecond beyond three days', () => {
    const debit = candidate({
      id: 'd1',
      type: 'DEBIT',
      transactionDate: new Date('2026-09-12T12:00:00.000Z'),
      account: { institutionId: 'bhd' },
    });
    const credit = candidate({
      id: 'c1',
      type: 'CREDIT',
      transactionDate: new Date(
        new Date('2026-09-15T12:00:00.000Z').getTime() + 1,
      ),
      account: { institutionId: 'qik' },
    });

    expect(pickTransferMatch(debit, [debit, credit]).match).toBeNull();
  });

  it('prefers the exact amount over a fee-tolerance candidate', () => {
    const debit = candidate({
      id: 'd1',
      type: 'DEBIT',
      account: { institutionId: 'bhd' },
    });
    const exact = candidate({
      id: 'c1',
      type: 'CREDIT',
      account: { institutionId: 'qik' },
    });
    const fee = candidate({
      id: 'c2',
      type: 'CREDIT',
      amount: 1040,
      account: { institutionId: 'popular' },
    });

    const preference = pickTransferMatch(debit, [debit, exact, fee]);
    expect(preference.match?.id).toBe('c1');
    expect(preference.candidateIds).toEqual(['c1']);
  });

  it('keeps the three day window when the reference is not shared', () => {
    const debit = candidate({
      id: 'd1',
      type: 'DEBIT',
      externalReference: 'REF-1',
      transactionDate: new Date('2026-09-10T12:00:00.000Z'),
      account: { institutionId: 'bhd' },
    });
    const otherReference = candidate({
      id: 'c1',
      type: 'CREDIT',
      externalReference: 'REF-2',
      transactionDate: new Date('2026-09-15T12:00:00.000Z'),
      account: { institutionId: 'qik' },
    });
    const noReference = candidate({
      id: 'c2',
      type: 'CREDIT',
      externalReference: null,
      transactionDate: new Date('2026-09-15T12:00:00.000Z'),
      account: { institutionId: 'popular' },
    });

    expect(pickTransferMatch(debit, [debit, otherReference]).match).toBeNull();
    expect(pickTransferMatch(debit, [debit, noReference]).match).toBeNull();
  });
});
