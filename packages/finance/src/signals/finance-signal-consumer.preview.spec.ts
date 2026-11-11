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
    confidence: 0.99,
    transaction: {
      kind: 'TRANSACTION',
      amount: 42.5,
      currency: 'DOP',
      transactionDate: '2026-11-01T00:00:00.000Z',
      direction: 'DEBIT',
      merchant: 'Market',
      bankReference: 'bank-1',
      bankStatusNormalized: 'COMPLETED',
      movementClass: 'PURCHASE',
    },
  },
};

function setup(overrides: Record<string, unknown> = {}) {
  const prisma = {
    finSignalImport: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    },
    finTransaction: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
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
    ...overrides,
  };
  const importTransaction = {
    execute: jest.fn().mockResolvedValue({ id: 'transaction-1' }),
    executeUnpairedTransfer: jest
      .fn()
      .mockResolvedValue({ id: 'transaction-1' }),
    executeAtmWithdrawal: jest
      .fn()
      .mockResolvedValue({ debit: { id: 'transaction-1' } }),
  };
  const ledger = {
    findTransactionByImportReference: jest.fn().mockResolvedValue(null),
    findTransactionByExternalReference: jest.fn().mockResolvedValue(null),
    findDedupeCandidate: jest.fn().mockResolvedValue(null),
    findLatestCategoryIdByMerchant: jest.fn().mockResolvedValue(null),
  };
  const consumer = new FinanceSignalConsumer(
    prisma as never,
    importTransaction as never,
    ledger as never,
    { execute: jest.fn() } as never,
    {
      preview: jest.fn().mockResolvedValue({ kind: 'new' }),
      execute: jest.fn(),
    } as never,
    { suggest: jest.fn().mockResolvedValue(null) } as never,
    { execute: jest.fn().mockResolvedValue('DOP') } as never,
  );
  return { consumer, prisma, importTransaction, ledger };
}

describe('FinanceSignalConsumer preview', () => {
  it('describes the movement it would create and writes nothing', async () => {
    const { consumer, prisma, importTransaction, ledger } = setup();

    const preview = await consumer.preview(signal);

    expect(preview).toMatchObject({
      outcome: 'APPLIED',
      movement: {
        accountId: 'account-1',
        cardId: null,
        amount: 42.5,
        currency: 'DOP',
        type: 'DEBIT',
        status: 'CONFIRMED',
        transactionDate: '2026-11-01T00:00:00.000Z',
        description: 'Market',
        importReference: 'email-message-1',
        externalReference: 'bank-1',
      },
    });
    expect(prisma.finSignalImport.upsert).not.toHaveBeenCalled();
    expect(importTransaction.execute).not.toHaveBeenCalled();
    expect(importTransaction.executeUnpairedTransfer).not.toHaveBeenCalled();
    expect(ledger.findDedupeCandidate).toHaveBeenCalled();
  });

  it('reports the review reason without persisting the import', async () => {
    const { consumer, prisma } = setup({
      finAccount: { findMany: jest.fn().mockResolvedValue([]) },
    });

    const preview = await consumer.preview(signal);

    expect(preview).toMatchObject({
      outcome: 'REVIEW_REQUIRED',
      reason: 'NO_LEDGER_TARGET',
    });
    expect(preview.movement).toBeUndefined();
    expect(prisma.finSignalImport.upsert).not.toHaveBeenCalled();
  });

  it('reports a stored import as already applied', async () => {
    const { consumer, prisma } = setup({
      finSignalImport: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'IMPORTED',
          reviewReason: null,
          transactionId: 'transaction-9',
          duplicateOfTransactionId: null,
        }),
        upsert: jest.fn(),
      },
    });

    const preview = await consumer.preview(signal);

    expect(preview).toMatchObject({
      outcome: 'ALREADY_APPLIED',
      domainReferences: [{ type: 'FinTransaction', id: 'transaction-9' }],
    });
    expect(prisma.finSignalImport.upsert).not.toHaveBeenCalled();
  });

  it('predicts a single transfer leg from the account hint', async () => {
    const { consumer } = setup({
      finAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'account-1',
            accountNumberLast4: '1234',
            isDefaultForInstitution: false,
            type: 'SAVINGS',
          },
        ]),
      },
    });
    const transferSignal: RoutedSignal = {
      ...signal,
      payload: {
        ...signal.payload,
        transaction: {
          kind: 'TRANSACTION',
          amount: 1500,
          currency: 'DOP',
          transactionDate: '2026-11-01T00:00:00.000Z',
          direction: 'DEBIT',
          movementClass: 'TRANSFER_OUT',
          accountNumberLast4: '1234',
          bankStatusNormalized: 'COMPLETED',
        },
      },
    };

    const preview = await consumer.preview(transferSignal);

    expect(preview.movement).toMatchObject({
      accountId: 'account-1',
      cardId: null,
      type: 'DEBIT',
      legRole: 'SOURCE',
    });
  });

  it('agrees with the applied result for the same signal', async () => {
    const previewConsumer = setup();
    const appliedConsumer = setup();

    const preview = await previewConsumer.consumer.preview(signal);
    const applied = await appliedConsumer.consumer.consume(signal);

    expect(preview.outcome).toBe(applied.outcome);
    expect(appliedConsumer.importTransaction.execute).toHaveBeenCalledTimes(1);
    expect(previewConsumer.importTransaction.execute).not.toHaveBeenCalled();
  });
});
