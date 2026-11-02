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
  };
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
    {} as never,
    { suggest: jest.fn().mockResolvedValue(null) } as never,
    {} as never,
  );
  return { consumer, prisma, importEmail, ledger };
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
