import type { RoutedSignal } from '@personal-os/contracts';
import { FinanceSignalConsumer } from './finance-signal-consumer';

const signal: RoutedSignal = {
  signalId: 'email-message-1',
  userId: 'user-1',
  signalType: 'FINANCE.TRANSACTION_DETECTED',
  schemaVersion: 1,
  occurredAt: '2026-11-02T10:00:00.000Z',
  sourceType: 'EMAIL_MESSAGE',
  sourceId: 'message-1',
  payload: {
    relevance: true,
    semanticType: 'FIN_TRANSACTION',
    routes: ['FINANCE'],
    confidence: 0.95,
    transaction: {
      kind: 'TRANSACTION',
      amount: 2500,
      currency: 'DOP',
      transactionDate: '2026-11-01T12:00:00.000Z',
      direction: 'DEBIT',
      movementClass: 'CARD_PAYMENT',
      last4: '4821',
      accountNumberLast4: '1234',
      bankReference: 'PAY-1',
      bankStatusNormalized: 'COMPLETED',
      statusConfidence: 0.95,
    },
  },
};

function setup({
  outcome = {
    kind: 'created',
    transferGroupId: 'group-1',
    sourceTransactionId: 'transaction-1',
    cardTransactionId: 'transaction-2',
  },
  accounts = [
    {
      id: 'account-1',
      accountNumberLast4: '1234',
      isDefaultForInstitution: false,
      type: 'SAVINGS',
      currency: 'DOP',
    },
  ],
  cards = [
    {
      id: 'card-1',
      type: 'CREDIT',
      lastFour: '4821',
      balances: [{ currency: 'DOP' }],
    },
  ],
  priorImport = null,
}: {
  outcome?: Record<string, unknown>;
  accounts?: Array<Record<string, unknown>>;
  cards?: Array<Record<string, unknown>>;
  priorImport?: Record<string, unknown> | null;
} = {}) {
  const prisma = {
    finSignalImport: {
      findUnique: jest.fn().mockResolvedValue(priorImport),
      upsert: jest.fn(),
    },
    finAccount: { findMany: jest.fn().mockResolvedValue(accounts) },
    finCard: { findMany: jest.fn().mockResolvedValue(cards) },
  };
  const cardPaymentImport = {
    preview: jest.fn().mockResolvedValue({ kind: 'new' }),
    execute: jest.fn().mockResolvedValue(outcome),
  };
  const consumer = new FinanceSignalConsumer(
    prisma as never,
    { execute: jest.fn(), executeUnpairedTransfer: jest.fn() } as never,
    {
      findTransactionByImportReference: jest.fn().mockResolvedValue(null),
      findTransactionByExternalReference: jest.fn().mockResolvedValue(null),
      findDedupeCandidate: jest.fn().mockResolvedValue(null),
      findLatestCategoryIdByMerchant: jest.fn().mockResolvedValue(null),
    } as never,
    { execute: jest.fn() } as never,
    cardPaymentImport as never,
    { suggest: jest.fn().mockResolvedValue(null) } as never,
    { execute: jest.fn().mockResolvedValue('DOP') } as never,
  );
  return { consumer, prisma, cardPaymentImport };
}

describe('FinanceSignalConsumer card payments', () => {
  it('previews both payment legs without writing', async () => {
    const { consumer, cardPaymentImport, prisma } = setup();

    await expect(consumer.preview(signal)).resolves.toMatchObject({
      outcome: 'APPLIED',
      cardPayment: {
        sourceAccountId: 'account-1',
        cardId: 'card-1',
        amount: 2500,
        currency: 'DOP',
        status: 'CONFIRMED',
        transactionDate: '2026-11-01T12:00:00.000Z',
        description: 'Pago de tarjeta',
        externalReference: 'PAY-1',
        importReference: 'email-message-1',
      },
    });
    expect(cardPaymentImport.execute).not.toHaveBeenCalled();
    expect(prisma.finSignalImport.upsert).not.toHaveBeenCalled();
  });

  it('imports one confirmed payment through the two-leg operation', async () => {
    const { consumer, cardPaymentImport } = setup();

    await expect(consumer.consume(signal)).resolves.toMatchObject({
      outcome: 'APPLIED',
      domainReferences: [{ type: 'FinTransaction', id: 'transaction-1' }],
    });
    expect(cardPaymentImport.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        sourceAccountId: 'account-1',
        sourceAccountCurrency: 'DOP',
        cardId: 'card-1',
        amount: 2500,
        currency: 'DOP',
        externalReference: 'PAY-1',
        importReference: 'email-message-1',
        status: 'CONFIRMED',
      }),
    );
  });

  it('does not create a movement for a pending notice or a reminder', async () => {
    const { consumer, cardPaymentImport } = setup();
    const pending: RoutedSignal = {
      ...signal,
      payload: {
        ...signal.payload,
        transaction: {
          ...(signal.payload.transaction as Record<string, unknown>),
          kind: 'PENDING',
          bankStatusNormalized: 'PENDING',
        },
      },
    };

    await expect(consumer.consume(pending)).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'CARD_PAYMENT_NOT_CONFIRMED',
    });
    expect(cardPaymentImport.execute).not.toHaveBeenCalled();
  });

  it('sends a missing card to review', async () => {
    const { consumer, cardPaymentImport } = setup({ cards: [] });

    await expect(consumer.consume(signal)).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'CARD_PAYMENT_CARD_NOT_FOUND',
    });
    expect(cardPaymentImport.execute).not.toHaveBeenCalled();
  });

  it('sends an ambiguous and a non credit card to review', async () => {
    const duplicated = setup({
      cards: [
        { id: 'card-1', type: 'CREDIT', lastFour: '4821', balances: [] },
        { id: 'card-2', type: 'CREDIT', lastFour: '4821', balances: [] },
      ],
    });
    await expect(duplicated.consumer.consume(signal)).resolves.toMatchObject({
      reason: 'CARD_PAYMENT_CARD_AMBIGUOUS',
    });

    const debit = setup({
      cards: [{ id: 'card-1', type: 'DEBIT', lastFour: '4821', balances: [] }],
    });
    await expect(debit.consumer.consume(signal)).resolves.toMatchObject({
      reason: 'CARD_PAYMENT_CARD_NOT_CREDIT',
    });
  });

  it('sends a missing or ambiguous source account to review', async () => {
    const missing = setup({ accounts: [] });
    await expect(missing.consumer.consume(signal)).resolves.toMatchObject({
      reason: 'CARD_PAYMENT_SOURCE_ACCOUNT_NOT_FOUND',
    });

    const ambiguous = setup({
      accounts: [
        {
          id: 'account-1',
          accountNumberLast4: '1234',
          currency: 'DOP',
        },
        {
          id: 'account-2',
          accountNumberLast4: '1234',
          currency: 'DOP',
        },
      ],
    });
    await expect(ambiguous.consumer.consume(signal)).resolves.toMatchObject({
      reason: 'CARD_PAYMENT_SOURCE_ACCOUNT_AMBIGUOUS',
    });
  });

  it('sends a card without balance in the currency to review', async () => {
    const { consumer } = setup({
      cards: [
        {
          id: 'card-1',
          type: 'CREDIT',
          lastFour: '4821',
          balances: [{ currency: 'USD' }],
        },
      ],
    });

    await expect(consumer.consume(signal)).resolves.toMatchObject({
      reason: 'CARD_CURRENCY_MISSING',
    });
  });

  it('links the payment the operation reports as duplicate', async () => {
    const { consumer, prisma } = setup({
      outcome: {
        kind: 'duplicate',
        transferGroupId: 'group-1',
        sourceTransactionId: 'existing-source',
      },
    });

    await expect(consumer.consume(signal)).resolves.toMatchObject({
      outcome: 'ALREADY_APPLIED',
      domainReferences: [{ type: 'FinTransaction', id: 'existing-source' }],
    });
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'DUPLICATE',
          duplicateOfTransactionId: 'existing-source',
        }),
      }),
    );
  });

  it('sends a reference conflict to review with the candidates', async () => {
    const { consumer, prisma } = setup({
      outcome: {
        kind: 'review',
        reason: 'CARD_PAYMENT_REFERENCE_CONFLICT',
        candidateTransactionIds: ['existing-source'],
      },
    });

    await expect(consumer.consume(signal)).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'CARD_PAYMENT_REFERENCE_CONFLICT',
    });
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'REVIEW_REQUIRED',
          candidate: expect.objectContaining({
            financeImportEvidence: expect.objectContaining({
              externalReference: 'PAY-1',
              candidateTransactionIds: ['existing-source'],
            }),
          }),
        }),
      }),
    );
  });

  it('sends several candidates to review without writing', async () => {
    const { consumer, cardPaymentImport } = setup({
      outcome: {
        kind: 'review',
        reason: 'CARD_PAYMENT_RECONCILIATION_AMBIGUOUS',
        candidateTransactionIds: ['manual-a', 'manual-b'],
      },
    });

    await expect(consumer.consume(signal)).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'CARD_PAYMENT_RECONCILIATION_AMBIGUOUS',
    });
    expect(cardPaymentImport.execute).toHaveBeenCalledTimes(1);
  });

  it('reports a payment that could not be written', async () => {
    const { consumer } = setup({ outcome: { kind: 'not_written' } });

    await expect(consumer.consume(signal)).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'CARD_PAYMENT_NOT_IMPORTED',
    });
  });

  it('returns the stored result on replay without new legs', async () => {
    const { consumer, cardPaymentImport, prisma } = setup({
      priorImport: {
        status: 'IMPORTED',
        reviewReason: null,
        transactionId: 'transaction-1',
        duplicateOfTransactionId: null,
      },
    });

    await expect(consumer.consume(signal)).resolves.toMatchObject({
      outcome: 'ALREADY_APPLIED',
    });
    expect(cardPaymentImport.execute).not.toHaveBeenCalled();
    expect(prisma.finSignalImport.upsert).not.toHaveBeenCalled();
  });

  it('reads only the products of the signal user', async () => {
    const { consumer, prisma } = setup();

    await consumer.consume(signal);

    expect(prisma.finAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', isActive: true },
      }),
    );
    expect(prisma.finCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', isActive: true },
      }),
    );
  });
});
