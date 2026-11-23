import type { RoutedSignal } from '@personal-os/contracts';
import { createFinanceSignalConsumer } from './signal-consumer.test-setup';

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
      bankReference: 'BHD-CARD-1',
      last4: '6506',
      movementClass: 'PURCHASE',
      bankStatusNormalized: 'APPROVED',
      statusConfidence: 0.95,
    },
  },
};

const transferSignal: RoutedSignal = {
  ...purchaseSignal,
  signalId: 'email-message-2',
  sourceId: 'message-2',
  payload: {
    ...purchaseSignal.payload,
    transaction: {
      kind: 'TRANSACTION',
      amount: 1200,
      currency: 'DOP',
      transactionDate: '2026-11-01T18:30:00.000Z',
      direction: 'TRANSFER',
      bankReference: 'BHD-TRA-1',
      accountNumberLast4: '0016',
      movementClass: 'TRANSFER_OUT',
      bankStatusNormalized: 'COMPLETED',
      statusConfidence: 0.95,
    },
  },
};

const cardPaymentSignal: RoutedSignal = {
  ...purchaseSignal,
  signalId: 'email-message-3',
  sourceId: 'message-3',
  payload: {
    ...purchaseSignal.payload,
    transaction: {
      kind: 'TRANSACTION',
      amount: 3000,
      currency: 'DOP',
      transactionDate: '2026-11-01T18:30:00.000Z',
      direction: 'DEBIT',
      merchant: 'Pago de tarjeta',
      bankReference: 'BHD-PAY-1',
      last4: '6506',
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

type StoredImport = {
  status: string;
  reviewReason: string | null;
  transactionId: string | null;
  duplicateOfTransactionId: string | null;
  candidate: Record<string, unknown>;
};

function storedReview(reviewReason: string): StoredImport {
  return {
    status: 'REVIEW_REQUIRED',
    reviewReason,
    transactionId: null,
    duplicateOfTransactionId: null,
    candidate: {},
  };
}

type SetupOptions = {
  prior?: StoredImport | null;
  accounts?: Array<Record<string, unknown>>;
  cards?: Array<Record<string, unknown>>;
  importedTransaction?: { id: string } | null;
};

function setup({
  prior = null,
  accounts = [],
  cards = [],
  importedTransaction = null,
}: SetupOptions = {}) {
  const executeRaw = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    $executeRaw: executeRaw,
    $transaction: jest.fn((handler: (tx: never) => unknown) =>
      handler({ $executeRaw: executeRaw } as never),
    ),
    finSignalImport: {
      findUnique: jest.fn().mockResolvedValue(prior),
      findFirst: jest.fn().mockResolvedValue({ status: 'REVIEW_REQUIRED' }),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
    },
    finTransaction: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    finAccount: { findMany: jest.fn().mockResolvedValue(accounts) },
    finCard: { findMany: jest.fn().mockResolvedValue(cards) },
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
    findTransactionByImportReference: jest
      .fn()
      .mockResolvedValue(importedTransaction),
    findTransactionByExternalReference: jest.fn().mockResolvedValue(null),
    findTransactionsByExternalReference: jest.fn().mockResolvedValue([]),
    findImportedTransactionByEmailMessageId: jest.fn().mockResolvedValue(null),
    findReverseCandidates: jest.fn().mockResolvedValue([]),
    findReverseCandidatesByCard: jest.fn().mockResolvedValue([]),
    findLinkedRefundTotal: jest.fn().mockResolvedValue(0),
    findDedupeCandidate: jest.fn().mockResolvedValue(null),
    findLatestCategoryIdByMerchant: jest.fn().mockResolvedValue(null),
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
  const consumer = createFinanceSignalConsumer({
    prisma: prisma,
    importTransaction: importTransaction,
    ledger: ledger,
    reverseTransaction: { execute: jest.fn() },
    cardPaymentImport: cardPaymentImport,
    merchants: { suggest: jest.fn().mockResolvedValue(null) },
    baseCurrency: { execute: jest.fn().mockResolvedValue('DOP') },
  });
  return { consumer, prisma, importTransaction, ledger, cardPaymentImport };
}

describe('FinanceSignalConsumer revisión por falta de destino', () => {
  it('vuelve a buscar la tarjeta de un import previo en revisión', async () => {
    const { consumer, prisma } = setup({
      prior: storedReview('NO_LEDGER_TARGET'),
      cards: [visaPremia],
    });

    const preview = await consumer.preview(purchaseSignal);

    expect(preview).toMatchObject({
      outcome: 'APPLIED',
      movement: {
        cardId: 'card-visa',
        accountId: null,
        amount: 250.75,
        currency: 'DOP',
      },
    });
    expect(prisma.finCard.findMany).toHaveBeenCalled();
    expect(prisma.finSignalImport.upsert).not.toHaveBeenCalled();
  });

  it('importa una sola vez al reevaluar y el replay no duplica el movimiento', async () => {
    const { consumer, prisma, importTransaction } = setup({
      prior: storedReview('NO_LEDGER_TARGET'),
      cards: [visaPremia],
    });

    await expect(consumer.consume(purchaseSignal)).resolves.toMatchObject({
      outcome: 'APPLIED',
      domainReferences: [{ type: 'FinTransaction', id: 'transaction-1' }],
    });
    expect(importTransaction.execute).toHaveBeenCalledTimes(1);
    expect(importTransaction.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        cardId: 'card-visa',
        importReference: 'email-message-1',
      }),
    );
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: 'IMPORTED',
          transactionId: 'transaction-1',
        }),
      }),
    );

    prisma.finSignalImport.findUnique.mockResolvedValue({
      status: 'IMPORTED',
      reviewReason: null,
      transactionId: 'transaction-1',
      duplicateOfTransactionId: null,
      candidate: {},
    });

    await expect(consumer.consume(purchaseSignal)).resolves.toMatchObject({
      outcome: 'ALREADY_APPLIED',
      domainReferences: [{ type: 'FinTransaction', id: 'transaction-1' }],
    });
    expect(importTransaction.execute).toHaveBeenCalledTimes(1);
  });

  it('no duplica el movimiento cuando la señal ya está importada en el libro', async () => {
    const { consumer, prisma, importTransaction } = setup({
      prior: storedReview('NO_LEDGER_TARGET'),
      cards: [visaPremia],
      importedTransaction: { id: 'transaction-existing' },
    });

    await expect(consumer.consume(purchaseSignal)).resolves.toMatchObject({
      outcome: 'ALREADY_APPLIED',
      domainReferences: [
        { type: 'FinTransaction', id: 'transaction-existing' },
      ],
    });
    expect(importTransaction.execute).not.toHaveBeenCalled();
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: 'IMPORTED',
          transactionId: 'transaction-existing',
        }),
      }),
    );
  });

  it('vuelve a buscar la cuenta de una transferencia en revisión', async () => {
    const { consumer, importTransaction } = setup({
      prior: storedReview('TRANSFER_ACCOUNT_NOT_FOUND'),
      accounts: [bhdAccount],
    });

    await expect(consumer.consume(transferSignal)).resolves.toMatchObject({
      outcome: 'APPLIED',
    });
    expect(importTransaction.executeUnpairedTransfer).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        accountId: 'account-bhd',
        importReference: 'email-message-2',
      }),
    );
  });

  it('vuelve a buscar la tarjeta y la cuenta de un pago en revisión', async () => {
    const { consumer, cardPaymentImport } = setup({
      prior: storedReview('CARD_PAYMENT_CARD_NOT_FOUND'),
      accounts: [bhdAccount],
      cards: [visaPremia],
    });

    await expect(consumer.consume(cardPaymentSignal)).resolves.toMatchObject({
      outcome: 'APPLIED',
      domainReferences: [
        { type: 'FinTransaction', id: 'transaction-payment-1' },
      ],
    });
    expect(cardPaymentImport.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        sourceAccountId: 'account-bhd',
        cardId: 'card-visa',
      }),
    );
  });

  it('conserva la revisión cuando el destino sigue ausente', async () => {
    const { consumer, prisma, importTransaction } = setup({
      prior: storedReview('NO_LEDGER_TARGET'),
    });

    await expect(consumer.consume(purchaseSignal)).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'NO_LEDGER_TARGET',
    });
    expect(importTransaction.execute).not.toHaveBeenCalled();
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: 'REVIEW_REQUIRED',
          reviewReason: 'NO_LEDGER_TARGET',
        }),
      }),
    );
  });

  it('no recalcula una revisión por un motivo distinto a la falta de destino', async () => {
    const { consumer, prisma, ledger } = setup({
      prior: storedReview('TRANSACTION_DATE_SUGGESTED'),
      cards: [visaPremia],
    });

    await expect(consumer.consume(purchaseSignal)).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'TRANSACTION_DATE_SUGGESTED',
    });
    expect(prisma.finCard.findMany).not.toHaveBeenCalled();
    expect(ledger.findTransactionByImportReference).not.toHaveBeenCalled();
    expect(prisma.finSignalImport.upsert).not.toHaveBeenCalled();
  });

  it('devuelve un import aplicado sin volver a calcularlo', async () => {
    const { consumer, prisma, ledger, importTransaction } = setup({
      prior: {
        status: 'IMPORTED',
        reviewReason: null,
        transactionId: 'transaction-1',
        duplicateOfTransactionId: null,
        candidate: {},
      },
      cards: [visaPremia],
    });

    await expect(consumer.consume(purchaseSignal)).resolves.toMatchObject({
      outcome: 'ALREADY_APPLIED',
      domainReferences: [{ type: 'FinTransaction', id: 'transaction-1' }],
    });
    expect(ledger.findTransactionByImportReference).not.toHaveBeenCalled();
    expect(importTransaction.execute).not.toHaveBeenCalled();
    expect(prisma.finAccount.findMany).not.toHaveBeenCalled();
  });
});
