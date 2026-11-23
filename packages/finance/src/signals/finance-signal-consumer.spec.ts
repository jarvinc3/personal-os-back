import type { RoutedSignal } from '@personal-os/contracts';
import {
  PartialReversalAlreadyAppliedError,
  PartialReversalExceedsOriginalError,
} from '../ledger/application/partial-reversal.errors';
import { createFinanceSignalConsumer } from './signal-consumer.test-setup';

const signal: RoutedSignal = {
  signalId: 'signal-1',
  userId: 'user-1',
  signalType: 'FINANCE.TRANSACTION_DETECTED',
  schemaVersion: 1,
  occurredAt: '2026-11-02T10:00:00.000Z',
  sourceType: 'EMAIL_MESSAGE',
  sourceId: 'email-1',
  payload: {
    relevance: true,
    semanticType: 'FIN_TRANSACTION',
    routes: ['FINANCE'],
    confidence: 0.99,
    transaction: {
      kind: 'TRANSACTION',
      amount: 42.5,
      currency: 'USD',
      transactionDate: '2026-11-01T00:00:00.000Z',
      direction: 'DEBIT',
      merchant: 'Market',
      bankReference: 'bank-1',
      bankStatusNormalized: 'COMPLETED',
      statusEvidence: 'Completada',
      transferExchangeRate: 1.02,
    },
  },
};

function setup(overrides: Record<string, unknown> = {}) {
  const executeRaw = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    $executeRaw: executeRaw,
    $transaction: jest.fn((handler: (tx: never) => unknown) =>
      handler({
        $executeRaw: executeRaw,
        finSignalImport: {
          findFirst: jest.fn().mockResolvedValue({ status: 'REVIEW_REQUIRED' }),
        },
      } as never),
    ),
    finSignalImport: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue({ status: 'REVIEW_REQUIRED' }),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
    },
    finTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
    finAccount: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'account-1',
          accountNumberLast4: null,
          isDefaultForInstitution: true,
        },
      ]),
    },
    finCard: { findMany: jest.fn().mockResolvedValue([]) },
    finCategory: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const importEmail = {
    execute: jest.fn().mockResolvedValue({ id: 'transaction-1' }),
    executeUnpairedTransfer: jest
      .fn()
      .mockResolvedValue({ id: 'transaction-1' }),
    pairTransferLegs: jest.fn().mockResolvedValue(undefined),
  };
  const reverseTransaction = {
    execute: jest.fn().mockResolvedValue(undefined),
  };
  const baseCurrency = { execute: jest.fn().mockResolvedValue('USD') };
  const ledger = {
    findTransactionByImportReference: jest.fn().mockResolvedValue(null),
    findImportedTransactionByEmailMessageId: jest.fn().mockResolvedValue(null),
    findLinkedRefundTotal: jest.fn().mockResolvedValue(0),
    findDedupeCandidate: jest.fn().mockResolvedValue(null),
    findLatestCategoryIdByMerchant: jest.fn().mockResolvedValue(null),
    ...((overrides.ledger as Record<string, jest.Mock> | undefined) ?? {}),
  };
  const consumer = createFinanceSignalConsumer({
    prisma: { ...prisma, ...overrides },
    importTransaction: importEmail,
    ledger: ledger,
    reverseTransaction: reverseTransaction,
    cardPaymentImport: { execute: jest.fn().mockResolvedValue(null) },
    merchants: { suggest: jest.fn().mockResolvedValue(null) },
    baseCurrency: baseCurrency,
  });
  return { consumer, prisma, importEmail, ledger, reverseTransaction };
}

describe('FinanceSignalConsumer', () => {
  it('imports once by signal and stores source trace and original money evidence', async () => {
    const { consumer, prisma, importEmail } = setup();
    await expect(consumer.consume(signal)).resolves.toMatchObject({
      outcome: 'APPLIED',
    });
    const input = importEmail.execute.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(input).toMatchObject({
      importReference: 'signal-1',
      amount: 42.5,
      currency: 'USD',
    });
    expect(input.aiMetadata).toMatchObject({
      signalId: 'signal-1',
      sourceEmailMessageId: 'email-1',
      originalAmount: 42.5,
      originalCurrency: 'USD',
      sourceExchangeRate: 1.02,
      statusEvidence: 'Completada',
    });
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_signalId: { userId: 'user-1', signalId: 'signal-1' } },
        create: expect.objectContaining({
          sourceEmailMessageId: 'email-1',
          transactionId: 'transaction-1',
        }),
      }),
    );
  });

  it('routes a candidate without a unique ledger target to review', async () => {
    const { consumer, prisma } = setup({
      finAccount: { findMany: jest.fn().mockResolvedValue([]) },
    });
    await expect(consumer.consume(signal)).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'NO_LEDGER_TARGET',
    });
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'REVIEW_REQUIRED',
          reviewReason: 'NO_LEDGER_TARGET',
        }),
      }),
    );
  });

  it('keeps a candidate without an operation date and suggestion in review', async () => {
    const { consumer, prisma, importEmail } = setup();
    const noDate = {
      ...signal,
      payload: {
        ...signal.payload,
        transaction: {
          ...(signal.payload.transaction as Record<string, unknown>),
          transactionDate: undefined,
        },
      },
    } as RoutedSignal;

    await expect(consumer.consume(noDate)).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'TRANSACTION_DATE_MISSING',
    });

    expect(importEmail.execute).not.toHaveBeenCalled();
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          reviewReason: 'TRANSACTION_DATE_MISSING',
        }),
      }),
    );
  });

  it('shows an email header date as a suggestion without importing it', async () => {
    const { consumer, prisma, importEmail } = setup();
    const suggested = {
      ...signal,
      payload: {
        ...signal.payload,
        transaction: {
          ...(signal.payload.transaction as Record<string, unknown>),
          transactionDate: undefined,
          suggestedTransactionDate: '2026-10-31T00:00:00.000Z',
          suggestedTransactionDateSource: 'EMAIL_HEADER',
        },
      },
    } as RoutedSignal;

    await expect(consumer.consume(suggested)).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'TRANSACTION_DATE_SUGGESTED',
    });

    expect(importEmail.execute).not.toHaveBeenCalled();
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'REVIEW_REQUIRED',
          reviewReason: 'TRANSACTION_DATE_SUGGESTED',
          candidate: expect.objectContaining({
            transaction: expect.objectContaining({
              suggestedTransactionDate: '2026-10-31T00:00:00.000Z',
              suggestedTransactionDateSource: 'EMAIL_HEADER',
            }),
            financeImportEvidence: expect.objectContaining({
              suggestedTransactionDate: '2026-10-31T00:00:00.000Z',
              suggestedTransactionDateSource: 'EMAIL_HEADER',
            }),
          }),
        }),
      }),
    );
  });

  it('uses a confirmed operation date and preserves the original suggestion', async () => {
    const { consumer, importEmail } = setup();
    const confirmed = {
      ...signal,
      payload: {
        ...signal.payload,
        transaction: {
          ...(signal.payload.transaction as Record<string, unknown>),
          transactionDate: '2026-11-03T00:00:00.000Z',
          suggestedTransactionDate: '2026-10-31T00:00:00.000Z',
          suggestedTransactionDateSource: 'EMAIL_HEADER',
        },
      },
    } as RoutedSignal;

    await expect(consumer.consume(confirmed)).resolves.toMatchObject({
      outcome: 'APPLIED',
    });

    expect(importEmail.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        transactionDate: new Date('2026-11-03T00:00:00.000Z'),
        aiMetadata: expect.objectContaining({
          suggestedTransactionDate: '2026-10-31T00:00:00.000Z',
          suggestedTransactionDateSource: 'EMAIL_HEADER',
        }),
      }),
    );
  });

  it('uses a stable ambiguous target reason and stores the candidate count as evidence', async () => {
    const { consumer, prisma } = setup({
      finCard: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'card-1', lastFour: '4821' },
          { id: 'card-2', lastFour: '4821' },
        ]),
      },
    });
    const ambiguous = {
      ...signal,
      payload: {
        ...signal.payload,
        transaction: {
          ...(signal.payload.transaction as Record<string, unknown>),
          last4: '4821',
        },
      },
    } as RoutedSignal;

    await expect(consumer.consume(ambiguous)).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'AMBIGUOUS_LEDGER_TARGET',
    });

    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          reviewReason: 'AMBIGUOUS_LEDGER_TARGET',
          candidate: expect.objectContaining({
            financeImportEvidence: {
              candidateCount: 2,
              candidateIds: ['card-1', 'card-2'],
            },
          }),
        }),
      }),
    );
  });

  it('returns the stored import on replay without creating another movement', async () => {
    const { consumer, importEmail } = setup({
      finSignalImport: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'IMPORTED',
          transactionId: 'transaction-1',
          reviewReason: null,
        }),
      },
    });
    await expect(consumer.consume(signal)).resolves.toMatchObject({
      outcome: 'ALREADY_APPLIED',
    });
    expect(importEmail.execute).not.toHaveBeenCalled();
  });

  it('preserves a pending bank status on the imported movement', async () => {
    const { consumer, importEmail } = setup();
    const pending = {
      ...signal,
      payload: {
        ...signal.payload,
        transaction: {
          ...(signal.payload.transaction as Record<string, unknown>),
          kind: 'PENDING',
        },
      },
    } as RoutedSignal;
    await consumer.consume(pending);
    expect(importEmail.execute.mock.calls[0][1]).toMatchObject({
      status: 'PENDING',
    });
  });

  it('imports a reclassified email with its own amount, currency and card', async () => {
    const { consumer, importEmail } = setup({
      finCard: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'card-1', lastFour: '4821' }]),
      },
    });
    const reclassified = {
      ...signal,
      signalId: 'email-m2',
      sourceId: 'm2',
      payload: {
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        confidence: 0.98,
        transaction: {
          kind: 'TRANSACTION',
          amount: 3400,
          currency: 'DOP',
          transactionDate: '2026-11-01T00:00:00.000Z',
          direction: 'DEBIT',
          last4: '4821',
          movementClass: 'PURCHASE',
          bankStatusNormalized: 'COMPLETED',
        },
      },
    } as RoutedSignal;

    await expect(consumer.consume(reclassified)).resolves.toMatchObject({
      outcome: 'APPLIED',
    });
    expect(importEmail.execute.mock.calls[0][1]).toMatchObject({
      cardId: 'card-1',
      importReference: 'email-m2',
      amount: 3400,
      currency: 'DOP',
    });
  });

  it('imports an unpaired transfer from its own account hint', async () => {
    const { consumer, importEmail } = setup({
      finAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'account-1',
            accountNumberLast4: '5678',
            type: 'SAVINGS',
            isDefaultForInstitution: false,
          },
        ]),
      },
    });
    const transfer = {
      ...signal,
      payload: {
        ...signal.payload,
        transaction: {
          kind: 'TRANSACTION',
          amount: 42.5,
          currency: 'USD',
          transactionDate: '2026-11-01T00:00:00.000Z',
          direction: 'TRANSFER',
          movementClass: 'TRANSFER_OUT',
          bankStatusNormalized: 'COMPLETED',
          accountNumberLast4: '5678',
        },
      },
    } as RoutedSignal;

    await expect(consumer.consume(transfer)).resolves.toMatchObject({
      outcome: 'APPLIED',
    });
    expect(importEmail.executeUnpairedTransfer).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ accountId: 'account-1', legRole: 'SOURCE' }),
    );
  });

  it('reverses the original movement and records the reversal source', async () => {
    const original = {
      id: 'original-1',
      status: 'CONFIRMED',
      type: 'DEBIT',
      transferGroupId: null,
      amount: 42.5,
      currency: 'USD',
      accountId: 'account-1',
      cardId: null,
      categoryId: null,
      aiMetadata: { movementClass: 'PURCHASE' },
    };
    const { consumer, prisma, reverseTransaction } = setup({
      ledger: {
        findTransactionsByExternalReference: jest
          .fn()
          .mockResolvedValue([original]),
      },
    });
    const reversal = {
      ...signal,
      signalId: 'signal-reversal',
      payload: {
        ...signal.payload,
        transaction: {
          kind: 'TRANSACTION',
          amount: 42.5,
          currency: 'USD',
          transactionDate: '2026-11-01T00:00:00.000Z',
          direction: 'DEBIT',
          bankReference: 'bank-reversal',
          reverseOfBankReference: 'bank-1',
          bankStatusNormalized: 'REVERSED',
        },
      },
    } as RoutedSignal;

    await expect(consumer.consume(reversal)).resolves.toMatchObject({
      outcome: 'APPLIED',
      domainReferences: [{ type: 'FinTransaction', id: 'original-1' }],
    });
    expect(reverseTransaction.execute).toHaveBeenCalledWith(
      'user-1',
      'original-1',
      expect.objectContaining({ reversalSignalId: 'signal-reversal' }),
    );
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'REVERSED' }),
      }),
    );
  });

  it('records a bank-level duplicate without creating a new movement', async () => {
    const { consumer, prisma, importEmail } = setup({
      ledger: {
        findDedupeCandidate: jest.fn().mockResolvedValue({ id: 'existing-tx' }),
      },
    });
    await expect(consumer.consume(signal)).resolves.toMatchObject({
      outcome: 'ALREADY_APPLIED',
      domainReferences: [{ type: 'FinTransaction', id: 'existing-tx' }],
    });
    expect(importEmail.execute).not.toHaveBeenCalled();
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'DUPLICATE',
          duplicateOfTransactionId: 'existing-tx',
        }),
      }),
    );
  });
});

const transferAccounts = [
  {
    id: 'account-1',
    accountNumberLast4: '5678',
    type: 'SAVINGS',
    isDefaultForInstitution: false,
  },
  {
    id: 'account-2',
    accountNumberLast4: '1234',
    type: 'CHECKING',
    isDefaultForInstitution: false,
  },
];

const transferDate = new Date('2026-11-01T00:00:00.000Z');

function transferSignal(
  transaction: Record<string, unknown> = {},
): RoutedSignal {
  return {
    ...signal,
    signalId: 'signal-transfer-1',
    sourceId: 'email-transfer-1',
    payload: {
      relevance: true,
      semanticType: 'FIN_TRANSACTION',
      routes: ['FINANCE'],
      confidence: 0.99,
      transaction: {
        kind: 'TRANSACTION',
        amount: 100,
        currency: 'DOP',
        transactionDate: '2026-11-01T00:00:00.000Z',
        direction: 'TRANSFER',
        movementClass: 'TRANSFER_OUT',
        bankReference: 'ref-transfer-1',
        bankStatusNormalized: 'COMPLETED',
        accountNumberLast4: '5678',
        ...transaction,
      },
    },
  };
}

function setupTransfer(
  options: {
    accounts?: Array<Record<string, unknown>>;
    cards?: Array<Record<string, unknown>>;
    referenceMatches?: Array<Record<string, unknown>>;
    storedImport?: Record<string, unknown>;
  } = {},
) {
  const finTransaction = {
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue(options.referenceMatches ?? []),
  };
  const finAccount = {
    findMany: jest.fn().mockResolvedValue(options.accounts ?? transferAccounts),
  };
  const finCard = {
    findMany: jest.fn().mockResolvedValue(options.cards ?? []),
  };
  const finSignalImport = options.storedImport
    ? {
        findUnique: jest.fn().mockResolvedValue(options.storedImport),
        upsert: jest.fn(),
      }
    : undefined;
  const context = setup({
    finTransaction,
    finAccount,
    finCard,
    ...(finSignalImport ? { finSignalImport } : {}),
  });
  return { ...context, finTransaction, finAccount, finCard, finSignalImport };
}

describe('FinanceSignalConsumer transfer import', () => {
  it('imports one source leg for a transfer out', async () => {
    const { consumer, importEmail, finTransaction } = setupTransfer();

    await expect(consumer.consume(transferSignal())).resolves.toMatchObject({
      outcome: 'APPLIED',
    });

    expect(importEmail.executeUnpairedTransfer).toHaveBeenCalledTimes(1);
    const [userId, input] = importEmail.executeUnpairedTransfer.mock
      .calls[0] as [string, Record<string, unknown>];
    expect(userId).toBe('user-1');
    expect(input).toMatchObject({
      accountId: 'account-1',
      type: 'DEBIT',
      legRole: 'SOURCE',
      categoryId: null,
      externalReference: 'ref-transfer-1',
      importReference: 'signal-transfer-1',
    });
    expect(input.cardId).toBeUndefined();
    expect(input.transferGroupId).toBeUndefined();
    expect(importEmail.execute).not.toHaveBeenCalled();
    expect(finTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'transaction-1', userId: 'user-1' },
      }),
    );
    expect(importEmail.pairTransferLegs).not.toHaveBeenCalled();
    expect(finTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          externalReference: 'ref-transfer-1',
        }),
      }),
    );
  });

  it('imports one destination leg for a transfer in', async () => {
    const { consumer, importEmail } = setupTransfer();

    await expect(
      consumer.consume(
        transferSignal({
          direction: 'CREDIT',
          movementClass: 'TRANSFER_IN',
          accountNumberLast4: '1234',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'APPLIED' });

    expect(importEmail.executeUnpairedTransfer).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        accountId: 'account-2',
        type: 'CREDIT',
        legRole: 'DESTINATION',
        categoryId: null,
      }),
    );
  });

  it('keeps a legitimate counterpart that shares the reference', async () => {
    const { consumer, importEmail, finTransaction } = setupTransfer({
      referenceMatches: [
        {
          id: 'leg-out',
          type: 'CREDIT',
          accountId: 'account-2',
          amount: { toString: () => '100' },
          currency: 'DOP',
          transactionDate: transferDate,
        },
      ],
    });

    await expect(consumer.consume(transferSignal())).resolves.toMatchObject({
      outcome: 'APPLIED',
    });

    expect(importEmail.executeUnpairedTransfer).toHaveBeenCalledTimes(1);
    const input = importEmail.executeUnpairedTransfer.mock
      .calls[0][1] as Record<string, unknown>;
    expect(input.transferGroupId).toBeUndefined();
    expect(finTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'transaction-1', userId: 'user-1' },
      }),
    );
    expect(importEmail.pairTransferLegs).not.toHaveBeenCalled();
  });

  it('does not import the same transfer leg twice', async () => {
    const { consumer, importEmail, prisma } = setupTransfer({
      referenceMatches: [
        {
          id: 'leg-existing',
          type: 'DEBIT',
          accountId: 'account-1',
          amount: 100,
          currency: 'DOP',
          transactionDate: transferDate,
        },
      ],
    });

    await expect(consumer.consume(transferSignal())).resolves.toMatchObject({
      outcome: 'ALREADY_APPLIED',
      domainReferences: [{ type: 'FinTransaction', id: 'leg-existing' }],
    });

    expect(importEmail.executeUnpairedTransfer).not.toHaveBeenCalled();
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'DUPLICATE',
          duplicateOfTransactionId: 'leg-existing',
        }),
      }),
    );
  });

  it('keeps the previous leg as duplicate after it reaches a terminal status', async () => {
    const { consumer, importEmail, finTransaction, prisma } = setupTransfer({
      referenceMatches: [
        {
          id: 'leg-reversed',
          type: 'DEBIT',
          accountId: 'account-1',
          amount: 100,
          currency: 'DOP',
          transactionDate: transferDate,
          status: 'REVERSED',
        },
      ],
    });

    await expect(consumer.consume(transferSignal())).resolves.toMatchObject({
      outcome: 'ALREADY_APPLIED',
      domainReferences: [{ type: 'FinTransaction', id: 'leg-reversed' }],
    });

    expect(importEmail.executeUnpairedTransfer).not.toHaveBeenCalled();
    const query = finTransaction.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(query.where).not.toHaveProperty('status');
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'DUPLICATE',
          duplicateOfTransactionId: 'leg-reversed',
        }),
      }),
    );
  });

  it('sends a reference conflict to review with no rows', async () => {
    const { consumer, importEmail, prisma } = setupTransfer({
      referenceMatches: [
        {
          id: 'leg-conflict',
          type: 'DEBIT',
          accountId: 'account-2',
          amount: 100,
          currency: 'DOP',
          transactionDate: transferDate,
        },
      ],
    });

    await expect(consumer.consume(transferSignal())).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'TRANSFER_REFERENCE_CONFLICT',
    });

    expect(importEmail.executeUnpairedTransfer).not.toHaveBeenCalled();
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'REVIEW_REQUIRED',
          reviewReason: 'TRANSFER_REFERENCE_CONFLICT',
          candidate: expect.objectContaining({
            financeImportEvidence: expect.objectContaining({
              externalReference: 'ref-transfer-1',
              candidateTransactionIds: ['leg-conflict'],
            }),
          }),
        }),
      }),
    );
  });

  it('rejects an ambiguous account with no rows and the candidates in evidence', async () => {
    const { consumer, importEmail, prisma } = setupTransfer({
      accounts: [
        {
          id: 'account-a',
          accountNumberLast4: '5567',
          type: 'SAVINGS',
          isDefaultForInstitution: false,
        },
        {
          id: 'account-b',
          accountNumberLast4: '5567',
          type: 'CHECKING',
          isDefaultForInstitution: false,
        },
      ],
    });

    await expect(
      consumer.consume(transferSignal({ accountNumberLast4: '5567' })),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'TRANSFER_ACCOUNT_AMBIGUOUS',
    });

    expect(importEmail.executeUnpairedTransfer).not.toHaveBeenCalled();
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'REVIEW_REQUIRED',
          reviewReason: 'TRANSFER_ACCOUNT_AMBIGUOUS',
          candidate: expect.objectContaining({
            financeImportEvidence: expect.objectContaining({
              candidateAccountIds: ['account-a', 'account-b'],
            }),
          }),
        }),
      }),
    );
  });

  it('rejects a missing account hint instead of using a default account', async () => {
    const { consumer, importEmail } = setupTransfer({
      accounts: [
        {
          id: 'account-default',
          accountNumberLast4: null,
          type: 'SAVINGS',
          isDefaultForInstitution: true,
        },
      ],
    });

    await expect(
      consumer.consume(transferSignal({ accountNumberLast4: undefined })),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'TRANSFER_ACCOUNT_MISSING',
    });

    expect(importEmail.executeUnpairedTransfer).not.toHaveBeenCalled();
  });

  it('rejects a transfer that only carries the card last four', async () => {
    const { consumer, importEmail } = setupTransfer({
      cards: [{ id: 'card-1', lastFour: '1111' }],
    });

    await expect(
      consumer.consume(
        transferSignal({ accountNumberLast4: undefined, last4: '1111' }),
      ),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'TRANSFER_ACCOUNT_HINT_UNSUPPORTED',
    });

    expect(importEmail.executeUnpairedTransfer).not.toHaveBeenCalled();
  });

  it('rejects an account hint that matches no account', async () => {
    const { consumer, importEmail } = setupTransfer();

    await expect(
      consumer.consume(transferSignal({ accountNumberLast4: '0000' })),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'TRANSFER_ACCOUNT_NOT_FOUND',
    });

    expect(importEmail.executeUnpairedTransfer).not.toHaveBeenCalled();
  });

  it('returns the stored transfer import on replay', async () => {
    const { consumer, importEmail } = setupTransfer({
      storedImport: {
        status: 'IMPORTED',
        transactionId: 'transaction-1',
        reviewReason: null,
      },
    });

    await expect(consumer.consume(transferSignal())).resolves.toMatchObject({
      outcome: 'ALREADY_APPLIED',
    });

    expect(importEmail.executeUnpairedTransfer).not.toHaveBeenCalled();
  });
});

const reversalOriginal = {
  id: 'original-1',
  userId: 'user-1',
  status: 'CONFIRMED',
  type: 'DEBIT',
  transferGroupId: null,
  amount: 100,
  currency: 'DOP',
  accountId: 'account-1',
  cardId: null,
  categoryId: 'category-1',
  merchant: 'Tienda',
  linkedTransactionId: null,
  aiMetadata: { movementClass: 'PURCHASE' },
};

function reversalSignal(
  transaction: Record<string, unknown> = {},
): RoutedSignal {
  return {
    ...signal,
    signalId: 'signal-reversal-1',
    sourceId: 'email-reversal-1',
    payload: {
      relevance: true,
      semanticType: 'FIN_TRANSACTION',
      routes: ['FINANCE'],
      confidence: 0.99,
      transaction: {
        kind: 'TRANSACTION',
        amount: 100,
        currency: 'DOP',
        transactionDate: '2026-11-05T00:00:00.000Z',
        direction: 'CREDIT',
        merchant: 'Tienda',
        bankReference: 'bank-reversal',
        reverseOfBankReference: 'bank-original',
        bankStatusNormalized: 'REVERSED',
        ...transaction,
      },
    },
  };
}

function setupReversal(
  options: {
    referenceOriginal?:
      Record<string, unknown> | Array<Record<string, unknown>> | null;
    emailOriginal?: Record<string, unknown> | null;
    candidates?: Array<Record<string, unknown>>;
    candidatesByCard?: Array<Record<string, unknown>>;
    pending?: Array<Record<string, unknown>>;
    linkedRefundTotal?: number;
  } = {},
) {
  const referenceOriginals = options.referenceOriginal
    ? Array.isArray(options.referenceOriginal)
      ? options.referenceOriginal
      : [options.referenceOriginal]
    : [];
  const ledger = {
    findTransactionByImportReference: jest.fn().mockResolvedValue(null),
    findLinkedRefundTotal: jest
      .fn()
      .mockResolvedValue(options.linkedRefundTotal ?? 0),
    findTransactionsByExternalReference: jest
      .fn()
      .mockResolvedValue(referenceOriginals),
    findImportedTransactionByEmailMessageId: jest
      .fn()
      .mockResolvedValue(options.emailOriginal ?? null),
    findReverseCandidates: jest
      .fn()
      .mockResolvedValue(options.candidates ?? []),
    findReverseCandidatesByCard: jest
      .fn()
      .mockResolvedValue(options.candidatesByCard ?? []),
    findDedupeCandidate: jest.fn().mockResolvedValue(null),
    findLatestCategoryIdByMerchant: jest.fn().mockResolvedValue(null),
  };
  const finSignalImport = {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue({ status: 'REVIEW_REQUIRED' }),
    findMany: jest.fn().mockResolvedValue(options.pending ?? []),
    upsert: jest.fn(),
  };
  const context = setup({ ledger, finSignalImport });
  return { ...context, ledger, finSignalImport };
}

describe('FinanceSignalConsumer reversal chain', () => {
  it('reviews the reversal when the explicit reference has no original', async () => {
    const { consumer, ledger } = setupReversal();

    await expect(consumer.consume(reversalSignal())).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'REVERSAL_REFERENCE_NOT_FOUND',
    });

    expect(ledger.findTransactionsByExternalReference).toHaveBeenCalledWith(
      'user-1',
      'bank-original',
    );
    expect(ledger.findReverseCandidates).not.toHaveBeenCalled();
  });

  it('never uses the reversal bank reference as the original', async () => {
    const { consumer, ledger } = setupReversal();

    await consumer.consume(
      reversalSignal({ reverseOfBankReference: undefined }),
    );

    expect(ledger.findTransactionsByExternalReference).not.toHaveBeenCalled();
    expect(ledger.findReverseCandidates).toHaveBeenCalledWith('user-1', {
      amount: 100,
      currency: 'DOP',
      merchant: 'Tienda',
      aroundDate: new Date('2026-11-05T00:00:00.000Z'),
      statuses: ['CONFIRMED'],
    });
  });

  it('links the original by the email message id', async () => {
    const { consumer, reverseTransaction } = setupReversal({
      emailOriginal: reversalOriginal,
    });

    await expect(
      consumer.consume(
        reversalSignal({
          reverseOfBankReference: undefined,
          reverseOfEmailMessageId: 'email-original-1',
        }),
      ),
    ).resolves.toMatchObject({
      outcome: 'APPLIED',
      domainReferences: [{ type: 'FinTransaction', id: 'original-1' }],
    });

    expect(reverseTransaction.execute).toHaveBeenCalledWith(
      'user-1',
      'original-1',
      expect.objectContaining({
        reversalStep: 'EMAIL',
        reverseOfEmailMessageId: 'email-original-1',
      }),
    );
  });

  it('links the only valid candidate and records the step', async () => {
    const { consumer, reverseTransaction, ledger } = setupReversal({
      candidates: [reversalOriginal],
    });

    await expect(
      consumer.consume(reversalSignal({ reverseOfBankReference: undefined })),
    ).resolves.toMatchObject({ outcome: 'APPLIED' });

    expect(reverseTransaction.execute).toHaveBeenCalledWith(
      'user-1',
      'original-1',
      expect.objectContaining({ reversalStep: 'CANDIDATE' }),
    );
    expect(ledger.findReverseCandidates).toHaveBeenCalledTimes(1);
  });

  it('reviews zero candidates and ambiguous candidates', async () => {
    const empty = setupReversal();
    await expect(
      empty.consumer.consume(
        reversalSignal({ reverseOfBankReference: undefined }),
      ),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'REVERSAL_ORIGINAL_NOT_FOUND',
    });

    const ambiguous = setupReversal({
      candidates: [reversalOriginal, { ...reversalOriginal, id: 'original-2' }],
    });
    await expect(
      ambiguous.consumer.consume(
        reversalSignal({ reverseOfBankReference: undefined }),
      ),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'REVERSAL_ORIGINAL_AMBIGUOUS',
    });
    expect(ambiguous.ledger.findReverseCandidates).toHaveBeenCalledTimes(1);
  });

  it('reviews when neither the merchant nor the card identifies the original', async () => {
    const { consumer, ledger } = setupReversal();

    await expect(
      consumer.consume(
        reversalSignal({
          reverseOfBankReference: undefined,
          merchant: undefined,
        }),
      ),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'REVERSAL_COMMERCE_MISSING',
    });

    expect(ledger.findReverseCandidates).not.toHaveBeenCalled();
    expect(ledger.findReverseCandidatesByCard).not.toHaveBeenCalled();
  });

  it('links a reversal without merchant to the only purchase on the same card', async () => {
    const { consumer, ledger, prisma, reverseTransaction } = setupReversal({
      candidatesByCard: [
        { ...reversalOriginal, cardId: 'card-1', accountId: null },
      ],
    });
    prisma.finCard.findMany.mockResolvedValue([
      { id: 'card-1', accountId: 'account-1' },
    ]);

    await expect(
      consumer.consume(
        reversalSignal({
          merchant: undefined,
          reverseOfBankReference: undefined,
          last4: '6506',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'APPLIED' });

    expect(ledger.findReverseCandidatesByCard).toHaveBeenCalledWith('user-1', {
      amount: 100,
      currency: 'DOP',
      cardId: 'card-1',
      accountId: 'account-1',
      from: new Date('2026-11-02T00:00:00.000Z'),
      to: new Date('2026-11-05T00:00:00.000Z'),
      statuses: ['CONFIRMED'],
    });
    expect(reverseTransaction.execute).toHaveBeenCalledWith(
      'user-1',
      'original-1',
      expect.objectContaining({
        reversalStep: 'CARD_ACCOUNT',
        reversalWindowDays: 3,
        reversalCardId: 'card-1',
        reversalAccountId: null,
      }),
    );
    expect(ledger.findReverseCandidates).not.toHaveBeenCalled();
  });

  it('retries a reversal in review for a missing merchant when its purchase arrives', async () => {
    const pendingCandidate = reversalSignal({
      merchant: undefined,
      reverseOfBankReference: undefined,
      last4: '6506',
    }).payload;
    const { consumer, prisma, finSignalImport, reverseTransaction } =
      setupReversal({
        pending: [
          {
            signalId: 'signal-reversal-1',
            sourceEmailMessageId: 'email-reversal-1',
            createdAt: new Date('2026-11-05T00:00:00.000Z'),
            candidate: pendingCandidate,
          },
        ],
        candidatesByCard: [{ ...reversalOriginal, cardId: 'card-1' }],
      });
    prisma.finCard.findMany.mockResolvedValue([
      { id: 'card-1', accountId: 'account-1' },
    ]);

    await expect(consumer.consume(signal)).resolves.toMatchObject({
      outcome: 'APPLIED',
    });

    expect(finSignalImport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          reviewReason: {
            in: expect.arrayContaining(['REVERSAL_COMMERCE_MISSING']),
          },
        }),
      }),
    );
    expect(reverseTransaction.execute).toHaveBeenCalledWith(
      'user-1',
      'original-1',
      expect.objectContaining({ reversalStep: 'CARD_ACCOUNT' }),
    );
  });

  it('uses a null account when the card has no account', async () => {
    const { consumer, ledger, prisma } = setupReversal({
      candidatesByCard: [reversalOriginal],
    });
    prisma.finCard.findMany.mockResolvedValue([
      { id: 'card-1', accountId: null },
    ]);

    await consumer.consume(
      reversalSignal({
        merchant: undefined,
        reverseOfBankReference: undefined,
        last4: '6506',
      }),
    );

    expect(ledger.findReverseCandidatesByCard).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ cardId: 'card-1', accountId: null }),
    );
  });

  it('reviews a card reversal with zero or several matching purchases', async () => {
    const empty = setupReversal({ candidatesByCard: [] });
    empty.prisma.finCard.findMany.mockResolvedValue([
      { id: 'card-1', accountId: 'account-1' },
    ]);
    await expect(
      empty.consumer.consume(
        reversalSignal({
          merchant: undefined,
          reverseOfBankReference: undefined,
          last4: '6506',
        }),
      ),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'REVERSAL_ORIGINAL_NOT_FOUND',
    });

    const ambiguous = setupReversal({
      candidatesByCard: [
        reversalOriginal,
        { ...reversalOriginal, id: 'original-2' },
      ],
    });
    ambiguous.prisma.finCard.findMany.mockResolvedValue([
      { id: 'card-1', accountId: 'account-1' },
    ]);
    await expect(
      ambiguous.consumer.consume(
        reversalSignal({
          merchant: undefined,
          reverseOfBankReference: undefined,
          last4: '6506',
        }),
      ),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'REVERSAL_ORIGINAL_AMBIGUOUS',
    });
  });

  it('reviews when the card is missing or ambiguous', async () => {
    const cardReversal = reversalSignal({
      merchant: undefined,
      reverseOfBankReference: undefined,
      last4: '6506',
    });

    const missing = setupReversal();
    missing.prisma.finCard.findMany.mockResolvedValue([]);
    await expect(missing.consumer.consume(cardReversal)).resolves.toMatchObject(
      {
        outcome: 'REVIEW_REQUIRED',
        reason: 'REVERSAL_ORIGINAL_NOT_FOUND',
      },
    );
    expect(missing.ledger.findReverseCandidatesByCard).not.toHaveBeenCalled();

    const ambiguous = setupReversal();
    ambiguous.prisma.finCard.findMany.mockResolvedValue([
      { id: 'card-1', accountId: 'account-1' },
      { id: 'card-2', accountId: 'account-2' },
    ]);
    await expect(
      ambiguous.consumer.consume(cardReversal),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'REVERSAL_ORIGINAL_AMBIGUOUS',
    });
    expect(ambiguous.ledger.findReverseCandidatesByCard).not.toHaveBeenCalled();
  });

  it('does not reverse a transfer leg', async () => {
    const { consumer, reverseTransaction } = setupReversal({
      referenceOriginal: { ...reversalOriginal, transferGroupId: 'group-1' },
    });

    await expect(consumer.consume(reversalSignal())).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'REVERSAL_TARGET_NOT_SUPPORTED',
    });

    expect(reverseTransaction.execute).not.toHaveBeenCalled();
  });

  it('links a partial reversal without marking the original', async () => {
    const { consumer, importEmail, reverseTransaction, finSignalImport } =
      setupReversal({ referenceOriginal: reversalOriginal });

    await expect(
      consumer.consume(reversalSignal({ amount: 40 })),
    ).resolves.toMatchObject({
      outcome: 'APPLIED',
      domainReferences: [{ type: 'FinTransaction', id: 'transaction-1' }],
    });

    expect(reverseTransaction.execute).not.toHaveBeenCalled();
    expect(importEmail.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        accountId: 'account-1',
        cardId: undefined,
        type: 'CREDIT',
        amount: 40,
        linkedTransactionId: 'original-1',
        sourceEmailMessageId: 'email-reversal-1',
        categoryId: 'category-1',
        importReference: 'signal-reversal-1',
      }),
    );
    expect(finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'IMPORTED',
          transactionId: 'transaction-1',
        }),
      }),
    );
  });

  it('links two distinct partial refunds with the same amount from different emails', async () => {
    const { consumer, importEmail } = setupReversal({
      referenceOriginal: reversalOriginal,
      linkedRefundTotal: 25,
    });

    await expect(
      consumer.consume(reversalSignal({ amount: 25 })),
    ).resolves.toMatchObject({
      outcome: 'APPLIED',
      domainReferences: [{ type: 'FinTransaction', id: 'transaction-1' }],
    });

    expect(importEmail.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        amount: 25,
        linkedTransactionId: 'original-1',
        sourceEmailMessageId: 'email-reversal-1',
      }),
    );
  });

  it('treats a replay from the same source email as already applied', async () => {
    const { consumer, importEmail } = setupReversal({
      referenceOriginal: reversalOriginal,
      emailOriginal: {
        id: 'refund-existing',
        type: 'CREDIT',
        linkedTransactionId: 'original-1',
      },
    });

    await expect(
      consumer.consume(reversalSignal({ amount: 25 })),
    ).resolves.toMatchObject({
      outcome: 'ALREADY_APPLIED',
      domainReferences: [{ type: 'FinTransaction', id: 'refund-existing' }],
    });

    expect(importEmail.execute).not.toHaveBeenCalled();
  });

  it('reviews a partial that the atomic guard finds over the purchase', async () => {
    const { consumer, importEmail, finSignalImport } = setupReversal({
      referenceOriginal: reversalOriginal,
    });
    importEmail.execute.mockRejectedValueOnce(
      new PartialReversalExceedsOriginalError({ originalId: 'original-1' }),
    );

    await expect(
      consumer.consume(reversalSignal({ amount: 25 })),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'REVERSAL_EXCEEDS_ORIGINAL',
    });

    expect(finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'REVIEW_REQUIRED',
          reviewReason: 'REVERSAL_EXCEEDS_ORIGINAL',
        }),
      }),
    );
  });

  it('returns ALREADY_APPLIED when the atomic guard sees a replay', async () => {
    const { consumer, importEmail, finSignalImport } = setupReversal({
      referenceOriginal: reversalOriginal,
    });
    importEmail.execute.mockRejectedValueOnce(
      new PartialReversalAlreadyAppliedError({
        transactionId: 'refund-existing',
      }),
    );

    await expect(
      consumer.consume(reversalSignal({ amount: 25 })),
    ).resolves.toMatchObject({
      outcome: 'ALREADY_APPLIED',
      domainReferences: [{ type: 'FinTransaction', id: 'refund-existing' }],
    });

    expect(finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'DUPLICATE',
          duplicateOfTransactionId: 'refund-existing',
        }),
      }),
    );
  });

  it('reviews two partial refunds whose sum exceeds the purchase', async () => {
    const { consumer, importEmail, reverseTransaction } = setupReversal({
      referenceOriginal: reversalOriginal,
      linkedRefundTotal: 70,
    });

    await expect(
      consumer.consume(reversalSignal({ amount: 60 })),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'REVERSAL_EXCEEDS_ORIGINAL',
    });

    expect(importEmail.execute).not.toHaveBeenCalled();
    expect(reverseTransaction.execute).not.toHaveBeenCalled();
  });

  it('links a second partial when the sum reaches the purchase', async () => {
    const { consumer, importEmail } = setupReversal({
      referenceOriginal: reversalOriginal,
      linkedRefundTotal: 40,
    });

    await expect(
      consumer.consume(reversalSignal({ amount: 60 })),
    ).resolves.toMatchObject({ outcome: 'APPLIED' });

    expect(importEmail.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        amount: 60,
        linkedTransactionId: 'original-1',
      }),
    );
  });

  it('links a second partial whose decimal sum reaches the purchase', async () => {
    const { consumer, importEmail } = setupReversal({
      referenceOriginal: { ...reversalOriginal, amount: 0.3 },
      linkedRefundTotal: 0.1,
    });

    await expect(
      consumer.consume(reversalSignal({ amount: 0.2 })),
    ).resolves.toMatchObject({ outcome: 'APPLIED' });

    expect(importEmail.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        amount: 0.2,
        linkedTransactionId: 'original-1',
      }),
    );
  });

  it('reviews a currency mismatch on the reference step', async () => {
    const { consumer, importEmail, reverseTransaction } = setupReversal({
      referenceOriginal: { ...reversalOriginal, currency: 'USD' },
    });

    await expect(consumer.consume(reversalSignal())).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'REVERSAL_CURRENCY_MISMATCH',
    });

    expect(importEmail.execute).not.toHaveBeenCalled();
    expect(reverseTransaction.execute).not.toHaveBeenCalled();
  });

  it('reviews a currency mismatch on the email step', async () => {
    const { consumer, importEmail, reverseTransaction } = setupReversal({
      emailOriginal: { ...reversalOriginal, currency: 'USD' },
    });

    await expect(
      consumer.consume(
        reversalSignal({
          reverseOfBankReference: undefined,
          reverseOfEmailMessageId: 'email-original-1',
        }),
      ),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'REVERSAL_CURRENCY_MISMATCH',
    });

    expect(importEmail.execute).not.toHaveBeenCalled();
    expect(reverseTransaction.execute).not.toHaveBeenCalled();
  });

  it('reviews a reference shared by two purchases without choosing one', async () => {
    const { consumer, importEmail, reverseTransaction } = setupReversal({
      referenceOriginal: [
        reversalOriginal,
        { ...reversalOriginal, id: 'original-2' },
      ],
    });

    await expect(consumer.consume(reversalSignal())).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'REVERSAL_ORIGINAL_AMBIGUOUS',
    });

    expect(importEmail.execute).not.toHaveBeenCalled();
    expect(reverseTransaction.execute).not.toHaveBeenCalled();
  });

  it('reviews a refund above the original amount', async () => {
    const { consumer, importEmail, reverseTransaction } = setupReversal({
      referenceOriginal: reversalOriginal,
    });

    await expect(
      consumer.consume(reversalSignal({ amount: 120 })),
    ).resolves.toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'REVERSAL_EXCEEDS_ORIGINAL',
    });

    expect(importEmail.execute).not.toHaveBeenCalled();
    expect(reverseTransaction.execute).not.toHaveBeenCalled();
  });

  it('retries a pending reversal after importing a new movement', async () => {
    const { consumer, reverseTransaction, finSignalImport } = setupReversal({
      referenceOriginal: reversalOriginal,
      pending: [
        {
          signalId: 'signal-pending',
          sourceEmailMessageId: 'email-pending',
          createdAt: new Date('2026-11-01T00:00:00.000Z'),
          candidate: reversalSignal().payload,
        },
      ],
    });

    await expect(consumer.consume(signal)).resolves.toMatchObject({
      outcome: 'APPLIED',
    });

    expect(reverseTransaction.execute).toHaveBeenCalledWith(
      'user-1',
      'original-1',
      expect.objectContaining({ reversalSignalId: 'signal-pending' }),
    );
    expect(finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_signalId: { userId: 'user-1', signalId: 'signal-pending' },
        },
        create: expect.objectContaining({ status: 'REVERSED' }),
      }),
    );
  });

  it('registers an email without merchant as pending merchant', async () => {
    const { consumer, importEmail } = setup({});

    await consumer.consume({
      ...signal,
      payload: {
        ...signal.payload,
        transaction: {
          ...signal.payload.transaction,
          merchant: undefined,
        },
      },
    });

    expect(importEmail.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        merchant: 'Comercio desconocido',
        merchantIsPlaceholder: true,
        aiMetadata: expect.objectContaining({ merchantMissing: true }),
      }),
    );
  });
});
