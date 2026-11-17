import type { RoutedSignal } from '@personal-os/contracts';
import { FinanceSignalConsumer } from './finance-signal-consumer';

const DAY_MS = 24 * 60 * 60 * 1000;

function transferSignal(): RoutedSignal {
  return {
    signalId: 'email-message-pair',
    userId: 'user-1',
    signalType: 'FINANCE.TRANSACTION_DETECTED',
    schemaVersion: 1,
    occurredAt: '2026-11-02T10:00:00.000Z',
    sourceType: 'EMAIL_MESSAGE',
    sourceId: 'message-pair',
    payload: {
      relevance: true,
      semanticType: 'FIN_TRANSACTION',
      routes: ['FINANCE'],
      confidence: 0.95,
      transaction: {
        kind: 'TRANSACTION',
        amount: 1000,
        currency: 'DOP',
        transactionDate: '2026-11-02T12:00:00.000Z',
        direction: 'DEBIT',
        movementClass: 'TRANSFER_OUT',
        accountNumberLast4: '1234',
        bankReference: 'REF-1',
        bankStatusNormalized: 'COMPLETED',
        statusConfidence: 0.95,
      },
    },
  };
}

function pairCandidate({
  id,
  type,
  externalReference,
  daysFromIncoming,
  transferGroupId,
  extraMs = 0,
  accountId = null,
  institutionId,
}: {
  id: string;
  type: 'DEBIT' | 'CREDIT';
  externalReference: string | null;
  daysFromIncoming: number;
  transferGroupId?: string;
  extraMs?: number;
  accountId?: string | null;
  institutionId?: string;
}) {
  return {
    id,
    type,
    accountId: accountId ?? null,
    externalReference,
    amount: 1000,
    amountBaseCurrency: 1000,
    currency: 'DOP',
    status: 'CONFIRMED',
    source: 'EMAIL',
    transactionDate: new Date(
      new Date('2026-11-02T12:00:00.000Z').getTime() -
        daysFromIncoming * DAY_MS -
        extraMs,
    ),
    transferGroupId: transferGroupId ?? `group-${id}`,
    categoryId: null,
    description: 'Transferencia',
    merchant: null,
    notes: null,
    aiMetadata: {
      movementClass: type === 'DEBIT' ? 'TRANSFER_OUT' : 'TRANSFER_IN',
    },
    account: { institutionId: institutionId ?? `inst-${id}`, type: 'SAVINGS' },
    card: null,
  };
}

const currentLeg = {
  id: 'transaction-1',
  type: 'DEBIT',
  accountId: 'account-1',
  externalReference: 'REF-1',
  amount: 1000,
  amountBaseCurrency: 1000,
  currency: 'DOP',
  status: 'CONFIRMED',
  source: 'EMAIL',
  transactionDate: new Date('2026-11-02T12:00:00.000Z'),
  transferGroupId: 'group-1',
  categoryId: null,
  description: 'Transferencia',
  merchant: null,
  notes: null,
  aiMetadata: { movementClass: 'TRANSFER_OUT' },
  account: { institutionId: 'bhd', type: 'SAVINGS' },
  card: null,
};

function setup({
  candidates = [],
  groupMembers = [],
}: {
  candidates?: Array<Record<string, unknown>>;
  groupMembers?: Array<Record<string, unknown>>;
} = {}) {
  const prisma = {
    finSignalImport: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    },
    finAccount: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'account-1',
          accountNumberLast4: '1234',
          isDefaultForInstitution: false,
          type: 'SAVINGS',
          currency: 'DOP',
        },
      ]),
    },
    finCard: { findMany: jest.fn().mockResolvedValue([]) },
    finCategory: { findMany: jest.fn().mockResolvedValue([]) },
    finTransaction: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'transaction-1',
        transferGroupId: 'group-1',
        transactionDate: new Date('2026-11-02T12:00:00.000Z'),
        aiMetadata: { movementClass: 'TRANSFER_OUT' },
        account: { institutionId: 'bhd', type: 'SAVINGS' },
        card: null,
      }),
      findMany: jest.fn(
        (args: {
          include?: unknown;
          where?: { transferGroupId?: unknown };
        }) => {
          const groupFilter = args.where?.transferGroupId;
          if (
            groupFilter &&
            typeof groupFilter === 'object' &&
            'in' in groupFilter
          ) {
            return Promise.resolve(groupMembers);
          }
          return Promise.resolve(
            args.include ? [currentLeg, ...candidates] : [],
          );
        },
      ),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const importEmail = {
    execute: jest.fn(),
    executeUnpairedTransfer: jest.fn().mockResolvedValue({
      id: 'transaction-1',
    }),
    pairTransferLegs: jest.fn().mockResolvedValue(undefined),
  };
  const consumer = new FinanceSignalConsumer(
    prisma as never,
    importEmail as never,
    {
      findTransactionByImportReference: jest.fn().mockResolvedValue(null),
      findTransactionByExternalReference: jest.fn().mockResolvedValue(null),
      findDedupeCandidate: jest.fn().mockResolvedValue(null),
      findLatestCategoryIdByMerchant: jest.fn().mockResolvedValue(null),
    } as never,
    { execute: jest.fn() } as never,
    { execute: jest.fn() } as never,
    { suggest: jest.fn().mockResolvedValue(null) } as never,
    { execute: jest.fn().mockResolvedValue('DOP') } as never,
  );
  return { consumer, prisma, importEmail };
}

describe('FinanceSignalConsumer transfer pairing', () => {
  it('pairs a unique opposite leg that shares the reference five days apart', async () => {
    const { consumer, importEmail } = setup({
      candidates: [
        pairCandidate({
          id: 'credit-1',
          type: 'CREDIT',
          externalReference: 'REF-1',
          daysFromIncoming: 5,
        }),
      ],
    });

    await expect(consumer.consume(transferSignal())).resolves.toMatchObject({
      outcome: 'APPLIED',
    });
    expect(importEmail.pairTransferLegs).toHaveBeenCalledWith(
      'user-1',
      'transaction-1',
      'credit-1',
    );
  });

  it('pairs the two BHD notices of the same transfer in the same account', async () => {
    const { consumer, importEmail } = setup({
      candidates: [
        pairCandidate({
          id: 'credit-1',
          type: 'CREDIT',
          externalReference: null,
          daysFromIncoming: 0,
          extraMs: 2 * 60 * 1000,
          accountId: 'account-1',
          institutionId: 'bhd',
        }),
      ],
    });

    await consumer.consume(transferSignal());

    expect(importEmail.pairTransferLegs).toHaveBeenCalledWith(
      'user-1',
      'transaction-1',
      'credit-1',
    );
  });

  it('does not pair a shared reference beyond seven days', async () => {
    const { consumer, importEmail } = setup({
      candidates: [
        pairCandidate({
          id: 'credit-1',
          type: 'CREDIT',
          externalReference: 'REF-1',
          daysFromIncoming: 10,
        }),
      ],
    });

    await consumer.consume(transferSignal());
    expect(importEmail.pairTransferLegs).not.toHaveBeenCalled();
  });

  it('pairs at exactly seven days and not one millisecond beyond', async () => {
    const exact = setup({
      candidates: [
        pairCandidate({
          id: 'credit-1',
          type: 'CREDIT',
          externalReference: 'REF-1',
          daysFromIncoming: 7,
        }),
      ],
    });

    await exact.consumer.consume(transferSignal());
    expect(exact.importEmail.pairTransferLegs).toHaveBeenCalledWith(
      'user-1',
      'transaction-1',
      'credit-1',
    );

    const beyond = setup({
      candidates: [
        pairCandidate({
          id: 'credit-2',
          type: 'CREDIT',
          externalReference: 'REF-1',
          daysFromIncoming: 7,
          extraMs: 1,
        }),
      ],
    });

    await beyond.consumer.consume(transferSignal());
    expect(beyond.importEmail.pairTransferLegs).not.toHaveBeenCalled();
  });

  it('does not re-pair a leg whose group mate is outside the window', async () => {
    const pairedGroup = 'group-ab';
    const groupMate = pairCandidate({
      id: 'debit-a',
      type: 'DEBIT',
      externalReference: 'REF-1',
      daysFromIncoming: 13,
      transferGroupId: pairedGroup,
    });
    const candidateB = pairCandidate({
      id: 'credit-b',
      type: 'CREDIT',
      externalReference: 'REF-1',
      daysFromIncoming: 6,
      transferGroupId: pairedGroup,
    });
    const { consumer, importEmail } = setup({
      candidates: [candidateB],
      groupMembers: [groupMate, candidateB],
    });

    await expect(consumer.consume(transferSignal())).resolves.toMatchObject({
      outcome: 'APPLIED',
    });
    expect(importEmail.pairTransferLegs).not.toHaveBeenCalled();
  });

  it('retries pairing when the same signal is replayed', async () => {
    const { consumer, importEmail, prisma } = setup({
      candidates: [
        pairCandidate({
          id: 'credit-1',
          type: 'CREDIT',
          externalReference: 'REF-1',
          daysFromIncoming: 5,
        }),
      ],
    });
    importEmail.pairTransferLegs.mockRejectedValueOnce(
      new Error('pairing failed'),
    );

    await expect(consumer.consume(transferSignal())).rejects.toThrow(
      'pairing failed',
    );
    expect(prisma.finSignalImport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'IMPORTED' }),
      }),
    );

    prisma.finSignalImport.findUnique.mockResolvedValue({
      status: 'IMPORTED',
      reviewReason: null,
      transactionId: 'transaction-1',
      duplicateOfTransactionId: null,
    });

    await expect(consumer.consume(transferSignal())).resolves.toMatchObject({
      outcome: 'ALREADY_APPLIED',
    });
    expect(importEmail.pairTransferLegs).toHaveBeenCalledTimes(2);
  });

  it('does not pair a different reference five days apart', async () => {
    const { consumer, importEmail } = setup({
      candidates: [
        pairCandidate({
          id: 'credit-1',
          type: 'CREDIT',
          externalReference: 'REF-2',
          daysFromIncoming: 5,
        }),
      ],
    });

    await consumer.consume(transferSignal());
    expect(importEmail.pairTransferLegs).not.toHaveBeenCalled();
  });

  it('keeps both legs pending with evidence when several candidates compete', async () => {
    const { consumer, importEmail, prisma } = setup({
      candidates: [
        pairCandidate({
          id: 'credit-1',
          type: 'CREDIT',
          externalReference: 'REF-1',
          daysFromIncoming: 1,
        }),
        pairCandidate({
          id: 'credit-2',
          type: 'CREDIT',
          externalReference: 'REF-1',
          daysFromIncoming: 2,
        }),
      ],
    });

    await consumer.consume(transferSignal());

    expect(importEmail.pairTransferLegs).not.toHaveBeenCalled();
    expect(prisma.finTransaction.update).toHaveBeenCalledWith({
      where: { id: 'transaction-1' },
      data: expect.objectContaining({
        aiMetadata: expect.objectContaining({
          movementClass: 'TRANSFER_OUT',
          transferPairing: {
            reason: 'TRANSFER_PAIR_AMBIGUOUS',
            candidateTransactionIds: ['credit-1', 'credit-2'],
          },
        }),
      }),
    });
  });

  it('does not try to pair a purchase', async () => {
    const { consumer, importEmail } = setup();
    const signal = transferSignal();
    const purchase: RoutedSignal = {
      ...signal,
      payload: {
        ...signal.payload,
        transaction: {
          ...(signal.payload.transaction as Record<string, unknown>),
          movementClass: 'PURCHASE',
          direction: 'DEBIT',
          last4: '4821',
          accountNumberLast4: undefined,
        },
      },
    };

    await consumer.consume(purchase);
    expect(importEmail.pairTransferLegs).not.toHaveBeenCalled();
  });
});
