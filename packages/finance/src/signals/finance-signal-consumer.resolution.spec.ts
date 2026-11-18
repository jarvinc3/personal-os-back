import type { RoutedSignal } from '@personal-os/contracts';
import { FinanceSignalConsumer } from './finance-signal-consumer';

const purchaseSignal: RoutedSignal = {
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
      amount: 250.75,
      currency: 'DOP',
      transactionDate: '2026-11-01T18:30:00.000Z',
      direction: 'DEBIT',
      merchant: 'Farmacia',
      last4: '6506',
      movementClass: 'PURCHASE',
      bankStatusNormalized: 'APPROVED',
      statusConfidence: 0.95,
    },
  },
};

const suggestedDateSignal: RoutedSignal = {
  ...purchaseSignal,
  signalId: 'email-message-2',
  sourceId: 'message-2',
  payload: {
    ...purchaseSignal.payload,
    transaction: {
      ...purchaseSignal.payload.transaction,
      transactionDate: undefined,
      suggestedTransactionDate: '2026-11-01T18:30:00.000Z',
      suggestedTransactionDateSource: 'EMAIL_HEADER',
    },
  },
};

const transferSignal: RoutedSignal = {
  ...purchaseSignal,
  signalId: 'email-message-3',
  sourceId: 'message-3',
  payload: {
    ...purchaseSignal.payload,
    transaction: {
      kind: 'TRANSACTION',
      amount: 1200,
      currency: 'DOP',
      transactionDate: '2026-11-01T18:30:00.000Z',
      direction: 'TRANSFER',
      movementClass: 'TRANSFER_OUT',
      bankStatusNormalized: 'COMPLETED',
      statusConfidence: 0.95,
    },
  },
};

const reversalSignal: RoutedSignal = {
  ...purchaseSignal,
  signalId: 'email-message-4',
  sourceId: 'message-4',
  payload: {
    ...purchaseSignal.payload,
    transaction: {
      kind: 'TRANSACTION',
      amount: 250.75,
      currency: 'DOP',
      transactionDate: '2026-11-02T18:30:00.000Z',
      direction: 'CREDIT',
      merchant: 'Farmacia',
      last4: '6506',
      movementClass: 'REFUND',
      bankStatusNormalized: 'REVERSED',
      statusConfidence: 0.95,
    },
  },
};

const cardPaymentSignal: RoutedSignal = {
  ...purchaseSignal,
  signalId: 'email-message-5',
  sourceId: 'message-5',
  payload: {
    ...purchaseSignal.payload,
    transaction: {
      kind: 'TRANSACTION',
      amount: 3000,
      currency: 'DOP',
      transactionDate: '2026-11-01T18:30:00.000Z',
      direction: 'DEBIT',
      merchant: 'Pago de tarjeta',
      accountNumberLast4: '0016',
      movementClass: 'CARD_PAYMENT',
      bankStatusNormalized: 'COMPLETED',
      statusConfidence: 0.95,
    },
  },
};

const visaPremia = {
  id: 'card-visa',
  lastFour: '6506',
  type: 'CREDIT',
  balances: [{ currency: 'DOP' }],
};

const bhdAccount = {
  id: 'account-bhd',
  accountNumberLast4: '0016',
  isDefaultForInstitution: false,
  type: 'SAVINGS',
  currency: 'DOP',
};

const confirmedPurchase = {
  id: 'purchase-1',
  status: 'CONFIRMED',
  type: 'DEBIT',
  transferGroupId: null,
  amount: 250.75,
  currency: 'DOP',
  accountId: null,
  cardId: 'card-visa',
  categoryId: 'category-1',
  aiMetadata: { template: 'farmacia' },
};

function setup({
  priorStatus = 'REVIEW_REQUIRED',
  accounts = [bhdAccount],
  cards = [visaPremia],
  chosenOriginal = confirmedPurchase,
}: {
  priorStatus?: string;
  accounts?: Array<Record<string, unknown>>;
  cards?: Array<Record<string, unknown>>;
  chosenOriginal?: Record<string, unknown> | null;
} = {}) {
  const prisma = {
    finSignalImport: {
      findUnique: jest.fn().mockResolvedValue({
        status: priorStatus,
        reviewReason: 'TRANSACTION_DATE_SUGGESTED',
        transactionId: null,
        duplicateOfTransactionId: null,
        candidate: {},
      }),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
    },
    finTransaction: {
      findFirst: jest.fn().mockResolvedValue(chosenOriginal),
      findMany: jest.fn().mockResolvedValue([]),
    },
    finAccount: { findMany: jest.fn().mockResolvedValue(accounts) },
    finCard: {
      findMany: jest.fn().mockResolvedValue(cards),
      findFirst: jest.fn().mockResolvedValue({
        id: 'card-visa',
        type: 'CREDIT',
        balances: [{ currency: 'DOP' }],
      }),
    },
    finCategory: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const importTransaction = {
    execute: jest.fn().mockResolvedValue({ id: 'transaction-1' }),
    executeUnpairedTransfer: jest
      .fn()
      .mockResolvedValue({ id: 'transaction-transfer-1' }),
    executeAtmWithdrawal: jest.fn(),
    pairTransferLegs: jest.fn().mockResolvedValue(undefined),
  };
  const ledger = {
    findTransactionByImportReference: jest.fn().mockResolvedValue(null),
    findTransactionByExternalReference: jest.fn().mockResolvedValue(null),
    findTransactionsByExternalReference: jest.fn().mockResolvedValue([]),
    findImportedTransactionByEmailMessageId: jest.fn().mockResolvedValue(null),
    findReverseCandidates: jest.fn().mockResolvedValue([]),
    findReverseCandidatesByCard: jest.fn().mockResolvedValue([]),
    findLinkedRefundTotal: jest.fn().mockResolvedValue(0),
    findDedupeCandidate: jest.fn().mockResolvedValue(null),
    findLatestCategoryIdByMerchant: jest.fn().mockResolvedValue(null),
  };
  const reverseTransaction = {
    execute: jest.fn().mockResolvedValue({}),
  };
  const cardPaymentImport = {
    preview: jest.fn().mockResolvedValue({ kind: 'new' }),
    execute: jest.fn().mockResolvedValue({
      kind: 'created',
      transferGroupId: 'group-1',
      sourceTransactionId: 'transaction-payment-1',
      cardTransactionId: 'transaction-payment-2',
    }),
  };
  const consumer = new FinanceSignalConsumer(
    prisma as never,
    importTransaction as never,
    ledger as never,
    reverseTransaction as never,
    cardPaymentImport as never,
    { suggest: jest.fn().mockResolvedValue(null) } as never,
    { execute: jest.fn().mockResolvedValue('DOP') } as never,
  );
  return {
    consumer,
    prisma,
    importTransaction,
    ledger,
    reverseTransaction,
    cardPaymentImport,
  };
}

describe('FinanceSignalConsumer con decisión humana', () => {
  it('importa con la fecha elegida aunque el correo solo traiga una sugerencia', async () => {
    const { consumer, importTransaction, prisma } = setup();
    const transactionDate = new Date('2026-10-30T12:00:00.000Z');

    await expect(
      consumer.consumeResolved({
        signal: suggestedDateSignal,
        override: { transactionDate },
      }),
    ).resolves.toMatchObject({ outcome: 'APPLIED' });

    expect(importTransaction.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ transactionDate }),
    );
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: 'IMPORTED' }),
      }),
    );
  });

  it('usa la cuenta elegida para un movimiento sin destino', async () => {
    const { consumer, importTransaction, prisma } = setup({
      cards: [],
    });
    const signal: RoutedSignal = {
      ...purchaseSignal,
      payload: {
        ...purchaseSignal.payload,
        transaction: {
          ...purchaseSignal.payload.transaction,
          last4: undefined,
        },
      },
    };

    await expect(
      consumer.consumeResolved({
        signal,
        override: { destination: { accountId: 'account-bhd' } },
      }),
    ).resolves.toMatchObject({ outcome: 'APPLIED' });

    expect(prisma.finCard.findMany).toHaveBeenCalled();
    expect(importTransaction.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ accountId: 'account-bhd', cardId: undefined }),
    );
  });

  it('registra una transferencia contra la cuenta elegida sin inventar contraparte', async () => {
    const { consumer, importTransaction } = setup();

    await expect(
      consumer.consumeResolved({
        signal: transferSignal,
        override: { destination: { accountId: 'account-bhd' } },
      }),
    ).resolves.toMatchObject({
      outcome: 'APPLIED',
      domainReferences: [{ id: 'transaction-transfer-1' }],
    });

    expect(importTransaction.executeUnpairedTransfer).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ accountId: 'account-bhd', legRole: 'SOURCE' }),
    );
  });

  it('rechaza una tarjeta como destino de una transferencia', async () => {
    const { consumer, importTransaction } = setup();

    await expect(
      consumer.consumeResolved({
        signal: transferSignal,
        override: { destination: { cardId: 'card-visa' } },
      }),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'TRANSFER_ACCOUNT_HINT_UNSUPPORTED',
    });
    expect(importTransaction.executeUnpairedTransfer).not.toHaveBeenCalled();
  });

  it('usa la cuenta elegida como origen de un pago de tarjeta', async () => {
    const { consumer, cardPaymentImport } = setup();
    const signal: RoutedSignal = {
      ...cardPaymentSignal,
      payload: {
        ...cardPaymentSignal.payload,
        transaction: {
          ...cardPaymentSignal.payload.transaction,
          last4: '6506',
          accountNumberLast4: undefined,
        },
      },
    };

    await expect(
      consumer.consumeResolved({
        signal,
        override: { destination: { accountId: 'account-bhd' } },
      }),
    ).resolves.toMatchObject({ outcome: 'APPLIED' });

    expect(cardPaymentImport.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ sourceAccountId: 'account-bhd' }),
    );
  });

  it('rechaza dos destinos en un movimiento que solo admite uno', async () => {
    const { consumer, importTransaction } = setup();
    const signal: RoutedSignal = {
      ...purchaseSignal,
      payload: {
        ...purchaseSignal.payload,
        transaction: {
          ...purchaseSignal.payload.transaction,
          last4: undefined,
        },
      },
    };

    await expect(
      consumer.consumeResolved({
        signal,
        override: {
          destination: { accountId: 'account-bhd', cardId: 'card-visa' },
        },
      }),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'AMBIGUOUS_LEDGER_TARGET',
    });
    expect(importTransaction.execute).not.toHaveBeenCalled();
  });

  it('usa la tarjeta elegida en un pago de tarjeta', async () => {
    const { consumer, cardPaymentImport, prisma } = setup();

    await expect(
      consumer.consumeResolved({
        signal: cardPaymentSignal,
        override: { destination: { cardId: 'card-visa' } },
      }),
    ).resolves.toMatchObject({ outcome: 'APPLIED' });

    expect(prisma.finCard.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'card-visa', userId: 'user-1', isActive: true },
      }),
    );
    expect(cardPaymentImport.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ cardId: 'card-visa' }),
    );
  });

  it('enlaza el reverso con el original elegido', async () => {
    const { consumer, reverseTransaction, prisma } = setup();

    await expect(
      consumer.consumeResolved({
        signal: reversalSignal,
        override: { originalTransactionId: 'purchase-1' },
      }),
    ).resolves.toMatchObject({
      outcome: 'APPLIED',
      domainReferences: [{ id: 'purchase-1' }],
    });

    expect(prisma.finTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'purchase-1', userId: 'user-1' },
      }),
    );
    expect(reverseTransaction.execute).toHaveBeenCalledWith(
      'user-1',
      'purchase-1',
      expect.objectContaining({ reversalSignalId: 'email-message-4' }),
    );
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: 'REVERSED' }),
      }),
    );
  });

  it('deja en revisión un original no confirmado', async () => {
    const { consumer, reverseTransaction } = setup({
      chosenOriginal: { ...confirmedPurchase, status: 'PENDING' },
    });

    await expect(
      consumer.consumeResolved({
        signal: reversalSignal,
        override: { originalTransactionId: 'purchase-1' },
      }),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'REVERSAL_ORIGINAL_NOT_CONFIRMED',
    });
    expect(reverseTransaction.execute).not.toHaveBeenCalled();
  });

  it('rechaza un original que no existe sin tocar el ledger', async () => {
    const { consumer, reverseTransaction } = setup({ chosenOriginal: null });

    await expect(
      consumer.consumeResolved({
        signal: reversalSignal,
        override: { originalTransactionId: 'missing' },
      }),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'REVERSAL_ORIGINAL_NOT_FOUND',
    });
    expect(reverseTransaction.execute).not.toHaveBeenCalled();
  });

  it('no reimporta un import descartado por una persona', async () => {
    const { consumer, importTransaction } = setup({
      priorStatus: 'DISMISSED',
    });

    await expect(consumer.consume(purchaseSignal)).resolves.toMatchObject({
      outcome: 'REJECTED',
      reason: 'IMPORT_DISMISSED_BY_USER',
    });
    expect(importTransaction.execute).not.toHaveBeenCalled();
  });
});
