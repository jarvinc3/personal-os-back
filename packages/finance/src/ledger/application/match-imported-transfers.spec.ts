import {
  isUnpairedTransferCandidate,
  pickTransferMatch,
  type ImportTransferCandidate,
} from './match-imported-transfers';

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
    expect(pickTransferMatch(debit, [debit, credit])?.id).toBe('c1');
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
    expect(pickTransferMatch(debit, [debit, first, second])).toBeNull();
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
});
