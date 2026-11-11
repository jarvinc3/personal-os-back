import {
  CARD_PAYMENT_REFERENCE_WINDOW_MS,
  CARD_PAYMENT_SIMILAR_WINDOW_MS,
  reconcileCardPaymentImport,
  type CardPaymentOperation,
  type IncomingCardPayment,
} from './reconcile-card-payment-import';

const DAY_MS = 24 * 60 * 60 * 1000;

const incoming: IncomingCardPayment = {
  accountId: 'account-1',
  cardId: 'card-1',
  amount: 2500,
  currency: 'DOP',
  transactionDate: new Date('2026-11-01T12:00:00.000Z'),
  bankReference: 'PAY-1',
};

function operation(
  overrides: Partial<CardPaymentOperation> = {},
): CardPaymentOperation {
  return {
    transferGroupId: 'group-1',
    sourceTransactionId: 'transaction-1',
    accountId: 'account-1',
    cardId: 'card-1',
    externalReference: 'PAY-1',
    amount: 2500,
    currency: 'DOP',
    transactionDate: new Date('2026-11-01T12:00:00.000Z'),
    ...overrides,
  };
}

describe('reconcileCardPaymentImport', () => {
  it('imports when there is no candidate', () => {
    expect(reconcileCardPaymentImport({ incoming, existing: [] })).toEqual({
      kind: 'new',
    });
  });

  it('links the same operation with the same reference inside seven days', () => {
    const decision = reconcileCardPaymentImport({
      incoming,
      existing: [
        operation({
          transactionDate: new Date(
            incoming.transactionDate.getTime() -
              CARD_PAYMENT_REFERENCE_WINDOW_MS +
              DAY_MS,
          ),
        }),
      ],
    });

    expect(decision).toEqual({
      kind: 'duplicate',
      transactionId: 'transaction-1',
      transferGroupId: 'group-1',
      matchedBy: 'REFERENCE',
    });
  });

  it('sends a reference outside the window to conflict', () => {
    const decision = reconcileCardPaymentImport({
      incoming,
      existing: [
        operation({
          transactionDate: new Date(
            incoming.transactionDate.getTime() -
              CARD_PAYMENT_REFERENCE_WINDOW_MS -
              DAY_MS,
          ),
        }),
      ],
    });

    expect(decision).toEqual({
      kind: 'conflict',
      reason: 'CARD_PAYMENT_REFERENCE_CONFLICT',
      candidateTransactionIds: ['transaction-1'],
    });
  });

  it('sends a reference with another amount to conflict', () => {
    const decision = reconcileCardPaymentImport({
      incoming,
      existing: [operation({ amount: 2400 })],
    });

    expect(decision).toEqual({
      kind: 'conflict',
      reason: 'CARD_PAYMENT_REFERENCE_CONFLICT',
      candidateTransactionIds: ['transaction-1'],
    });
  });

  it('sends a reference with another card to conflict', () => {
    const decision = reconcileCardPaymentImport({
      incoming,
      existing: [operation({ cardId: 'card-2' })],
    });

    expect(decision.kind).toBe('conflict');
  });

  it('links a similar payment without reference inside three days', () => {
    const decision = reconcileCardPaymentImport({
      incoming: { ...incoming, bankReference: null },
      existing: [
        operation({
          externalReference: null,
          transactionDate: new Date(
            incoming.transactionDate.getTime() +
              CARD_PAYMENT_SIMILAR_WINDOW_MS -
              DAY_MS,
          ),
        }),
      ],
    });

    expect(decision).toEqual({
      kind: 'duplicate',
      transactionId: 'transaction-1',
      transferGroupId: 'group-1',
      matchedBy: 'SIMILAR',
    });
  });

  it('creates a new payment when the similar one is outside three days', () => {
    const decision = reconcileCardPaymentImport({
      incoming: { ...incoming, bankReference: null },
      existing: [
        operation({
          externalReference: null,
          transactionDate: new Date(
            incoming.transactionDate.getTime() +
              CARD_PAYMENT_SIMILAR_WINDOW_MS +
              DAY_MS,
          ),
        }),
      ],
    });

    expect(decision).toEqual({ kind: 'new' });
  });

  it('ignores an existing payment that carries another reference', () => {
    const decision = reconcileCardPaymentImport({
      incoming: { ...incoming, bankReference: null },
      existing: [operation({ externalReference: 'OTHER-REF' })],
    });

    expect(decision).toEqual({ kind: 'new' });
  });

  it('sends several similar payments to review', () => {
    const decision = reconcileCardPaymentImport({
      incoming: { ...incoming, bankReference: null },
      existing: [
        operation({ externalReference: null, sourceTransactionId: 'a' }),
        operation({ externalReference: null, sourceTransactionId: 'b' }),
      ],
    });

    expect(decision).toEqual({
      kind: 'ambiguous',
      reason: 'CARD_PAYMENT_RECONCILIATION_AMBIGUOUS',
      candidateTransactionIds: ['a', 'b'],
    });
  });

  it('sends several exact reference matches to review', () => {
    const decision = reconcileCardPaymentImport({
      incoming,
      existing: [
        operation({ sourceTransactionId: 'a' }),
        operation({ sourceTransactionId: 'b' }),
      ],
    });

    expect(decision.kind).toBe('ambiguous');
  });

  it('does not compare payments of another account', () => {
    const decision = reconcileCardPaymentImport({
      incoming,
      existing: [operation({ accountId: 'account-2' })],
    });

    expect(decision.kind).toBe('conflict');
  });
});
