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

  it('imports an unpaired transfer without losing its transfer group', async () => {
    const { consumer, importEmail } = setup();
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
        },
      },
    } as RoutedSignal;

    await expect(consumer.consume(transfer)).resolves.toMatchObject({
      outcome: 'APPLIED',
    });
    expect(importEmail.executeUnpairedTransfer).toHaveBeenCalled();
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
