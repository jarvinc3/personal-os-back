import type { RoutedSignal } from '@personal-os/contracts';
import { FinanceSignalConsumer } from './finance-signal-consumer';

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
  const prisma = {
    finSignalImport: {
      findUnique: jest.fn().mockResolvedValue(null),
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
  };
  const reverseTransaction = {
    execute: jest.fn().mockResolvedValue(undefined),
  };
  const baseCurrency = { execute: jest.fn().mockResolvedValue('USD') };
  const ledger = {
    findTransactionByImportReference: jest.fn().mockResolvedValue(null),
    findDedupeCandidate: jest.fn().mockResolvedValue(null),
    findLatestCategoryIdByMerchant: jest.fn().mockResolvedValue(null),
    ...((overrides.ledger as Record<string, jest.Mock> | undefined) ?? {}),
  };
  const consumer = new FinanceSignalConsumer(
    { ...prisma, ...overrides } as never,
    importEmail as never,
    ledger as never,
    reverseTransaction as never,
    { suggest: jest.fn().mockResolvedValue(null) } as never,
    baseCurrency as never,
  );
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
      aiMetadata: { movementClass: 'PURCHASE' },
    };
    const { consumer, prisma, reverseTransaction } = setup({
      ledger: {
        findTransactionByExternalReference: jest
          .fn()
          .mockResolvedValue(original),
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
    expect(finTransaction.findFirst).not.toHaveBeenCalled();
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
    expect(finTransaction.findFirst).not.toHaveBeenCalled();
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
