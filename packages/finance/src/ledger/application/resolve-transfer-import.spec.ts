import {
  TRANSFER_REVIEW_REASON,
  classifyTransferImport,
  resolveTransferAccount,
  transferLegIdentity,
} from './resolve-transfer-import';

const accounts = [
  {
    id: 'account-savings',
    accountNumberLast4: '5678',
    type: 'SAVINGS',
    isDefaultForInstitution: false,
  },
  {
    id: 'account-checking',
    accountNumberLast4: '1234',
    type: 'CHECKING',
    isDefaultForInstitution: false,
  },
  {
    id: 'account-cash',
    accountNumberLast4: '5678',
    type: 'CASH',
    isDefaultForInstitution: false,
  },
];

const transactionDate = new Date('2026-11-01T00:00:00.000Z');

const incoming = {
  type: 'DEBIT' as const,
  accountId: 'account-savings',
  amount: 100,
  currency: 'DOP',
  transactionDate,
};

function existingLeg(
  overrides: Partial<{
    id: string;
    type: string;
    accountId: string | null;
    amount: number | { toString(): string };
    currency: string;
    transactionDate: Date;
  }> = {},
) {
  return {
    id: 'leg-existing',
    type: 'DEBIT',
    accountId: 'account-savings',
    amount: 100,
    currency: 'DOP',
    transactionDate,
    ...overrides,
  };
}

describe('resolveTransferAccount', () => {
  it('resolves the single account that matches the full number', () => {
    expect(
      resolveTransferAccount({
        accountNumberHint: '001122335678',
        hasCardLast4Hint: false,
        accounts,
      }),
    ).toEqual({ kind: 'unique', accountId: 'account-savings' });
  });

  it('resolves the single account that matches the last four digits', () => {
    expect(
      resolveTransferAccount({
        accountNumberHint: '5678',
        hasCardLast4Hint: false,
        accounts,
      }),
    ).toEqual({ kind: 'unique', accountId: 'account-savings' });
  });

  it('reports a missing account hint instead of using a default account', () => {
    expect(
      resolveTransferAccount({
        accountNumberHint: null,
        hasCardLast4Hint: false,
        accounts: [
          {
            id: 'account-default',
            accountNumberLast4: null,
            type: 'SAVINGS',
            isDefaultForInstitution: true,
          },
        ],
      }),
    ).toEqual({
      kind: 'missing',
      reason: TRANSFER_REVIEW_REASON.ACCOUNT_MISSING,
    });
  });

  it('rejects a transfer that only carries the card last four', () => {
    expect(
      resolveTransferAccount({
        accountNumberHint: null,
        hasCardLast4Hint: true,
        accounts,
      }),
    ).toEqual({
      kind: 'unsupported',
      reason: TRANSFER_REVIEW_REASON.ACCOUNT_HINT_UNSUPPORTED,
    });
  });

  it('reports no account when the hint matches nothing', () => {
    expect(
      resolveTransferAccount({
        accountNumberHint: '9999',
        hasCardLast4Hint: false,
        accounts,
      }),
    ).toEqual({
      kind: 'not_found',
      reason: TRANSFER_REVIEW_REASON.ACCOUNT_NOT_FOUND,
    });
  });

  it('reports ambiguity with the candidate accounts', () => {
    expect(
      resolveTransferAccount({
        accountNumberHint: '5567',
        hasCardLast4Hint: false,
        accounts: [
          {
            id: 'account-savings',
            accountNumberLast4: '5567',
            type: 'SAVINGS',
            isDefaultForInstitution: false,
          },
          {
            id: 'account-checking',
            accountNumberLast4: '5567',
            type: 'CHECKING',
            isDefaultForInstitution: false,
          },
        ],
      }),
    ).toEqual({
      kind: 'ambiguous',
      reason: TRANSFER_REVIEW_REASON.ACCOUNT_AMBIGUOUS,
      candidateAccountIds: ['account-savings', 'account-checking'],
    });
  });

  it('never resolves a cash account as a transfer account', () => {
    expect(
      resolveTransferAccount({
        accountNumberHint: '5678',
        hasCardLast4Hint: false,
        accounts: [accounts[2]],
      }),
    ).toEqual({
      kind: 'not_found',
      reason: TRANSFER_REVIEW_REASON.ACCOUNT_NOT_FOUND,
    });
  });
});

describe('transferLegIdentity', () => {
  it('maps a transfer out to a debit source leg', () => {
    expect(transferLegIdentity('TRANSFER_OUT')).toEqual({
      type: 'DEBIT',
      legRole: 'SOURCE',
    });
  });

  it('maps a transfer in to a credit destination leg', () => {
    expect(transferLegIdentity('TRANSFER_IN')).toEqual({
      type: 'CREDIT',
      legRole: 'DESTINATION',
    });
  });

  it('does not build a leg for a non-transfer movement', () => {
    expect(transferLegIdentity('PURCHASE')).toBeNull();
  });
});

describe('classifyTransferImport', () => {
  it('imports the first leg when nothing shares the reference', () => {
    expect(classifyTransferImport({ incoming, existing: [] })).toEqual({
      kind: 'import',
    });
  });

  it('does not import the same leg twice with the exact same date', () => {
    expect(
      classifyTransferImport({ incoming, existing: [existingLeg()] }),
    ).toEqual({ kind: 'duplicate', transactionId: 'leg-existing' });
  });

  it('compares stored decimals and exact milliseconds', () => {
    expect(
      classifyTransferImport({
        incoming,
        existing: [existingLeg({ amount: { toString: () => '100' } })],
      }),
    ).toEqual({ kind: 'duplicate', transactionId: 'leg-existing' });
  });

  it('imports the legitimate counterpart that shares the reference', () => {
    expect(
      classifyTransferImport({
        incoming,
        existing: [
          existingLeg({
            id: 'leg-counterpart',
            type: 'CREDIT',
            accountId: 'account-checking',
          }),
        ],
      }),
    ).toEqual({ kind: 'import' });
  });

  it('does not treat the same type on another account as a duplicate', () => {
    expect(
      classifyTransferImport({
        incoming,
        existing: [
          existingLeg({ id: 'leg-other', accountId: 'account-checking' }),
        ],
      }),
    ).toEqual({
      kind: 'conflict',
      reason: TRANSFER_REVIEW_REASON.REFERENCE_CONFLICT,
      candidateTransactionIds: ['leg-other'],
    });
  });

  it('does not treat the opposite type on the same account as a counterpart', () => {
    expect(
      classifyTransferImport({
        incoming,
        existing: [existingLeg({ id: 'leg-same-account', type: 'CREDIT' })],
      }),
    ).toEqual({
      kind: 'conflict',
      reason: TRANSFER_REVIEW_REASON.REFERENCE_CONFLICT,
      candidateTransactionIds: ['leg-same-account'],
    });
  });

  it('does not treat a row without account as a counterpart', () => {
    expect(
      classifyTransferImport({
        incoming,
        existing: [
          existingLeg({
            id: 'leg-no-account',
            type: 'CREDIT',
            accountId: null,
          }),
        ],
      }),
    ).toEqual({
      kind: 'conflict',
      reason: TRANSFER_REVIEW_REASON.REFERENCE_CONFLICT,
      candidateTransactionIds: ['leg-no-account'],
    });
  });

  it('sends a reference match with a different date to conflict', () => {
    expect(
      classifyTransferImport({
        incoming,
        existing: [
          existingLeg({
            transactionDate: new Date(transactionDate.getTime() + 1000),
          }),
        ],
      }),
    ).toEqual({
      kind: 'conflict',
      reason: TRANSFER_REVIEW_REASON.REFERENCE_CONFLICT,
      candidateTransactionIds: ['leg-existing'],
    });
  });

  it('sends a reference match with a different amount to conflict', () => {
    expect(
      classifyTransferImport({
        incoming,
        existing: [existingLeg({ amount: 99 })],
      }),
    ).toMatchObject({ kind: 'conflict' });
  });

  it('sends a reference match with a different currency to conflict', () => {
    expect(
      classifyTransferImport({
        incoming,
        existing: [existingLeg({ currency: 'USD' })],
      }),
    ).toMatchObject({ kind: 'conflict' });
  });

  it('does not choose between several reference matches', () => {
    expect(
      classifyTransferImport({
        incoming,
        existing: [
          existingLeg({
            id: 'leg-counterpart',
            type: 'CREDIT',
            accountId: 'account-checking',
          }),
          existingLeg({ id: 'leg-extra', accountId: 'account-checking' }),
        ],
      }),
    ).toEqual({
      kind: 'conflict',
      reason: TRANSFER_REVIEW_REASON.REFERENCE_CONFLICT,
      candidateTransactionIds: ['leg-counterpart', 'leg-extra'],
    });
  });
});
