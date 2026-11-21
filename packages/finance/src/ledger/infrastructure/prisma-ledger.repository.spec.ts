import type { DomainEventPublisher } from '@personal-os/contracts';
import { FinanceEvents } from '../../contracts';
import { PrismaLedgerDeletionRepository } from './prisma-ledger-deletion.repository';
import { PrismaLedgerImportRepository } from './prisma-ledger-import.repository';
import { PrismaLedgerWriteRepository } from './prisma-ledger-write.repository';
import { PrismaLedgerReadRepository } from './prisma-ledger-read.repository';
import {
  PartialReversalAlreadyAppliedError,
  PartialReversalExceedsOriginalError,
} from '../application/partial-reversal.errors';
import { PrismaLedgerRepository } from './prisma-ledger.repository';
import { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';

const journal = {
  record: jest.fn().mockResolvedValue({ id: 'journal-1' }),
  restore: jest.fn(),
} as unknown as DeletionJournalRepository;

const dopAmounts = {
  amount: 50,
  currency: 'DOP',
  ledgerAmount: 50,
  ledgerCurrency: 'DOP',
  amountBaseCurrency: 50,
  exchangeRate: 1,
};

/** Pending collected income, so the delete path skips the balance compensation. */
function collectedIncome() {
  return {
    id: 'tx-del',
    userId: 'user-1',
    amount: 50,
    status: 'PENDING',
    source: 'MANUAL',
    transferGroupId: null,
    accountId: 'acc-1',
    cardId: null,
  };
}

describe('PrismaLedgerRepository outbox-in-TX', () => {
  it('passes the same transaction client to outbox enqueue on create', async () => {
    const fakeTx = { name: 'tx-client' };
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisher;

    const finTransactionCreate = jest.fn().mockResolvedValue({
      id: 'tx-1',
      amount: 10,
      status: 'CONFIRMED',
      source: 'MANUAL',
      accountId: 'acc-1',
      cardId: null,
    });

    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          finTransaction: {
            create: finTransactionCreate,
            findFirst: jest.fn().mockResolvedValue({
              id: 'tx-1',
              amount: 10,
              status: 'CONFIRMED',
              source: 'MANUAL',
              currency: 'DOP',
              type: 'DEBIT',
              merchant: null,
              account: null,
              card: null,
              category: null,
            }),
          },
          finAccount: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'acc-1',
              currency: 'DOP',
              type: 'CHECKING',
            }),
          },
          finCard: { findFirst: jest.fn() },
          finBudget: { findMany: jest.fn().mockResolvedValue([]) },
        };
        Object.assign(tx, fakeTx);
        return fn(tx);
      }),
    };

    // Spy helpers by providing minimal behavior through resolveLedgerTarget needs
    // Use real $transaction mock with target resolution inline:
    // Override $transaction to call with a richer client
    prisma.$transaction = jest.fn(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          name: 'same-tx',
          finAccount: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'acc-1',
              userId: 'user-1',
              currency: 'DOP',
              type: 'CHECKING',
              balance: 100,
            }),
            update: jest.fn(),
          },
          finCard: { findFirst: jest.fn() },
          finCardBalance: { upsert: jest.fn() },
          finTransaction: {
            create: finTransactionCreate,
            findFirst: jest.fn().mockResolvedValue({
              id: 'tx-1',
              amount: 10,
              status: 'CONFIRMED',
              source: 'MANUAL',
              currency: 'DOP',
              type: 'DEBIT',
              merchant: null,
              account: null,
              card: null,
              category: null,
            }),
          },
          finBudget: {
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn(),
          },
        };
        return fn(tx);
      },
    );

    const repo = new PrismaLedgerRepository(
      prisma as never,
      new PrismaLedgerReadRepository(prisma as never),
      events,
      new PrismaLedgerDeletionRepository(prisma as never, events, journal),
      new PrismaLedgerImportRepository(prisma as never, events),
      new PrismaLedgerWriteRepository(prisma as never, events),
      undefined,
    );

    const result = await repo.createTransaction(
      'user-1',
      {
        type: 'DEBIT',
        amount: 10,
        transactionDate: '2026-08-01',
        accountId: 'acc-1',
      },
      {
        amount: 10,
        currency: 'DOP',
        ledgerAmount: 10,
        ledgerCurrency: 'DOP',
        amountBaseCurrency: 10,
        exchangeRate: 1,
      },
      'MANUAL',
    );

    expect(result?.transaction.id).toBe('tx-1');
    expect(enqueue).toHaveBeenCalled();
    const enqueueTx = enqueue.mock.calls[0]?.[1] as { name?: string };
    expect(enqueueTx?.name).toBe('same-tx');
  });

  it('marks the movement as quiet when the action already announced itself', async () => {
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisher;
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          finAccount: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'acc-1',
              userId: 'user-1',
              currency: 'DOP',
              type: 'CHECKING',
              balance: 100,
            }),
            update: jest.fn(),
          },
          finCard: { findFirst: jest.fn() },
          finCardBalance: { upsert: jest.fn() },
          finTransaction: {
            create: jest.fn().mockResolvedValue({
              id: 'tx-goal',
              amount: 10,
              status: 'CONFIRMED',
              source: 'MANUAL',
            }),
            findFirst: jest.fn().mockResolvedValue({
              id: 'tx-goal',
              amount: 10,
              status: 'CONFIRMED',
              source: 'MANUAL',
              currency: 'DOP',
              type: 'CREDIT',
              merchant: null,
              account: null,
              card: null,
              category: null,
            }),
          },
          finBudget: {
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn(),
          },
        };
        return fn(tx);
      }),
    };
    const repo = new PrismaLedgerRepository(
      prisma as never,
      new PrismaLedgerReadRepository(prisma as never),
      events,
      new PrismaLedgerDeletionRepository(prisma as never, events, journal),
      new PrismaLedgerImportRepository(prisma as never, events),
      new PrismaLedgerWriteRepository(prisma as never, events),
      undefined,
    );

    await repo.createTransaction(
      'user-1',
      {
        type: 'CREDIT',
        amount: 10,
        transactionDate: '2026-08-01',
        accountId: 'acc-1',
        announce: false,
      },
      {
        amount: 10,
        currency: 'DOP',
        ledgerAmount: 10,
        ledgerCurrency: 'DOP',
        amountBaseCurrency: 10,
        exchangeRate: 1,
      },
      'MANUAL',
    );

    expect(
      (enqueue.mock.calls[0]?.[0] as { payload?: unknown }).payload,
    ).toEqual(expect.objectContaining({ announce: false }));
  });

  it('createTransfer applies balances on both legs and enqueues finance.transfer.created', async () => {
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisher;
    const finAccountUpdate = jest.fn();

    const finTransactionCreate = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'debit-1',
        amount: 50,
        status: 'CONFIRMED',
        source: 'MANUAL',
        accountId: 'acc-from',
        cardId: null,
        type: 'DEBIT',
      })
      .mockResolvedValueOnce({
        id: 'credit-1',
        amount: 50,
        status: 'CONFIRMED',
        source: 'MANUAL',
        accountId: 'acc-to',
        cardId: null,
        type: 'CREDIT',
      });

    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          name: 'same-tx',
          finAccount: {
            findFirst: jest
              .fn()
              .mockImplementation(({ where }: { where: { id: string } }) => {
                if (where.id === 'acc-from') {
                  return Promise.resolve({
                    id: 'acc-from',
                    userId: 'user-1',
                    currency: 'DOP',
                    type: 'CHECKING',
                    balance: 200,
                  });
                }
                if (where.id === 'acc-to') {
                  return Promise.resolve({
                    id: 'acc-to',
                    userId: 'user-1',
                    currency: 'DOP',
                    type: 'CHECKING',
                    balance: 100,
                  });
                }
                return Promise.resolve(null);
              }),
            update: finAccountUpdate,
          },
          finCard: { findFirst: jest.fn() },
          finCardBalance: { upsert: jest.fn() },
          finTransaction: {
            create: finTransactionCreate,
            findFirst: jest.fn().mockResolvedValue({
              id: 'leg-1',
              amount: 50,
              status: 'CONFIRMED',
              source: 'MANUAL',
              currency: 'DOP',
              type: 'DEBIT',
              merchant: null,
              account: null,
              card: null,
              category: null,
            }),
          },
          finBudget: {
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn(),
          },
        };
        return fn(tx);
      }),
    };

    const repo = new PrismaLedgerRepository(
      prisma as never,
      new PrismaLedgerReadRepository(prisma as never),
      events,
      new PrismaLedgerDeletionRepository(prisma as never, events, journal),
      new PrismaLedgerImportRepository(prisma as never, events),
      new PrismaLedgerWriteRepository(prisma as never, events),
      undefined,
    );

    const createdTransfer = await repo.createTransfer({
      userId: 'user-1',
      command: {
        fromAccountId: 'acc-from',
        toAccountId: 'acc-to',
        amount: 50,
        transactionDate: '2026-08-01',
      },
      fromAmounts: dopAmounts,
      toAmounts: dopAmounts,
      estimated: false,
    });

    expect(createdTransfer?.transferGroupId).toBeDefined();
    expect(createdTransfer?.debit.id).toBe('debit-1');
    expect(createdTransfer?.credit.id).toBe('credit-1');
    expect(finAccountUpdate).toHaveBeenCalledTimes(2);
    expect(finAccountUpdate).toHaveBeenCalledWith({
      where: { id: 'acc-from' },
      data: { balance: { increment: -50 } },
    });
    expect(finAccountUpdate).toHaveBeenCalledWith({
      where: { id: 'acc-to' },
      data: { balance: { increment: 50 } },
    });

    const transferEnqueue = enqueue.mock.calls.find(
      (call) =>
        (call[0] as { eventName?: string }).eventName ===
        FinanceEvents.TRANSFER_CREATED,
    );
    expect(transferEnqueue).toBeDefined();
    expect(transferEnqueue?.[0]).toEqual(
      expect.objectContaining({
        eventName: FinanceEvents.TRANSFER_CREATED,
        aggregateType: 'FinTransfer',
        userId: 'user-1',
        payload: expect.objectContaining({
          debitId: 'debit-1',
          creditId: 'credit-1',
          amount: 50,
        }),
      }),
    );
    expect((transferEnqueue?.[1] as { name?: string })?.name).toBe('same-tx');
  });

  it('deleteTransaction restores CONFIRMED balances once and enqueues finance.transaction.deleted', async () => {
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisher;
    const finAccountUpdate = jest.fn();
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const existing = {
      id: 'tx-del',
      userId: 'user-1',
      source: 'MANUAL',
      status: 'CONFIRMED',
      type: 'DEBIT',
      amount: 50,
      ledgerAmount: 50,
      amountBaseCurrency: 50,
      currency: 'DOP',
      ledgerCurrency: 'DOP',
      accountId: 'acc-1',
      cardId: null,
      categoryId: null,
      transactionDate: new Date('2026-08-01'),
      transferGroupId: null,
    };

    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          name: 'same-tx',
          finAccount: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'acc-1',
              userId: 'user-1',
              currency: 'DOP',
              type: 'CHECKING',
              balance: 100,
            }),
            update: finAccountUpdate,
          },
          finCard: { findFirst: jest.fn() },
          finCardBalance: {
            findFirst: jest.fn(),
            update: jest.fn(),
            create: jest.fn(),
          },
          finTransaction: {
            findFirst: jest.fn().mockResolvedValue(existing),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            deleteMany,
          },
          finReceivablePayment: {
            findMany: jest.fn().mockResolvedValue([]),
            deleteMany: jest.fn(),
          },
          finLoanInstallment: { findMany: jest.fn().mockResolvedValue([]) },
          finSavingsGoalContribution: {
            findMany: jest.fn().mockResolvedValue([]),
          },
          finBudget: {
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn(),
          },
        };
        return fn(tx);
      }),
    };

    const repo = new PrismaLedgerRepository(
      prisma as never,
      new PrismaLedgerReadRepository(prisma as never),
      events,
      new PrismaLedgerDeletionRepository(prisma as never, events, journal),
      new PrismaLedgerImportRepository(prisma as never, events),
      new PrismaLedgerWriteRepository(prisma as never, events),
      undefined,
    );

    const result = await repo.deleteTransaction('user-1', 'tx-del');

    expect(result).toEqual({ count: 1 });
    expect(finAccountUpdate).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        eventName: FinanceEvents.TRANSACTION_DELETED,
        aggregateType: 'FinTransaction',
        aggregateId: 'tx-del',
        userId: 'user-1',
        payload: expect.objectContaining({
          transactionId: 'tx-del',
          transferGroupId: null,
          amount: 50,
          status: 'CONFIRMED',
          source: 'MANUAL',
        }),
      }),
    );
    expect((enqueue.mock.calls[0]?.[1] as { name?: string })?.name).toBe(
      'same-tx',
    );
  });

  it('deleteTransaction removes the collected payment and recomputes the receivable', async () => {
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisher;
    const paymentDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const receivableUpdate = jest.fn().mockResolvedValue({});

    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          name: 'same-tx',
          finTransaction: {
            findFirst: jest.fn().mockResolvedValue(collectedIncome()),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          finReceivablePayment: {
            findMany: jest
              .fn()
              .mockResolvedValue([{ id: 'pay-1', receivableId: 'rec-1' }]),
            deleteMany: paymentDeleteMany,
            aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
          },
          finReceivable: {
            findMany: jest.fn().mockResolvedValue([]),
            findUniqueOrThrow: jest.fn().mockResolvedValue({
              id: 'rec-1',
              amount: 80,
              status: 'PARTIAL',
            }),
            update: receivableUpdate,
          },
          finLoanInstallment: { findMany: jest.fn().mockResolvedValue([]) },
          finSavingsGoalContribution: {
            findMany: jest.fn().mockResolvedValue([]),
          },
        };
        return fn(tx);
      }),
    };

    const repo = new PrismaLedgerRepository(
      prisma as never,
      new PrismaLedgerReadRepository(prisma as never),
      events,
      new PrismaLedgerDeletionRepository(prisma as never, events, journal),
      new PrismaLedgerImportRepository(prisma as never, events),
      new PrismaLedgerWriteRepository(prisma as never, events),
      undefined,
    );

    await repo.deleteTransaction('user-1', 'tx-del');

    expect(paymentDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['pay-1'] } },
    });
    expect(receivableUpdate).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: { paidAmount: 0, status: 'PENDING' },
    });
  });

  it('deleteTransaction un-pays the instalment and moves the loan back', async () => {
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisher;
    const installmentUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const loanUpdate = jest.fn().mockResolvedValue({});

    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          name: 'same-tx',
          finTransaction: {
            findFirst: jest.fn().mockResolvedValue(collectedIncome()),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          finReceivablePayment: { findMany: jest.fn().mockResolvedValue([]) },
          finLoanInstallment: {
            findMany: jest.fn().mockResolvedValue([
              {
                id: 'inst-2',
                loan: {
                  id: 'loan-1',
                  paidInstallments: 2,
                  currentBalance: 3500,
                  installmentAmount: 1500,
                  installmentFreq: 'MONTHLY',
                  nextDueDate: new Date(Date.UTC(2026, 2, 5)),
                },
              },
            ]),
            updateMany: installmentUpdateMany,
          },
          finSavingsGoalContribution: {
            findMany: jest.fn().mockResolvedValue([]),
          },
          finLoan: {
            findMany: jest.fn().mockResolvedValue([]),
            update: loanUpdate,
          },
        };
        return fn(tx);
      }),
    };

    const repo = new PrismaLedgerRepository(
      prisma as never,
      new PrismaLedgerReadRepository(prisma as never),
      events,
      new PrismaLedgerDeletionRepository(prisma as never, events, journal),
      new PrismaLedgerImportRepository(prisma as never, events),
      new PrismaLedgerWriteRepository(prisma as never, events),
      undefined,
    );

    await repo.deleteTransaction('user-1', 'tx-del');

    expect(installmentUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['inst-2'] } },
      data: { paidAt: null, transactionId: null },
    });
    expect(loanUpdate).toHaveBeenCalledWith({
      where: { id: 'loan-1' },
      data: {
        paidInstallments: 1,
        currentBalance: 5000,
        nextDueDate: new Date(Date.UTC(2026, 1, 5)),
      },
    });
  });

  it('reverseTransaction reverts the collected payment too', async () => {
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisher;
    const paymentDeleteMany = jest.fn().mockResolvedValue({ count: 1 });

    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          name: 'same-tx',
          finTransaction: {
            findFirst: jest.fn().mockResolvedValue(collectedIncome()),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findFirstOrThrow: jest
              .fn()
              .mockResolvedValue({ ...collectedIncome(), status: 'REVERSED' }),
          },
          finReceivablePayment: {
            findMany: jest
              .fn()
              .mockResolvedValue([{ id: 'pay-1', receivableId: 'rec-1' }]),
            deleteMany: paymentDeleteMany,
            aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
          },
          finReceivable: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({
              id: 'rec-1',
              amount: 80,
              status: 'PENDING',
            }),
            update: jest.fn(),
          },
          finLoanInstallment: { findMany: jest.fn().mockResolvedValue([]) },
          finSavingsGoalContribution: {
            findMany: jest.fn().mockResolvedValue([]),
          },
        };
        return fn(tx);
      }),
    };

    const repo = new PrismaLedgerRepository(
      prisma as never,
      new PrismaLedgerReadRepository(prisma as never),
      events,
      new PrismaLedgerDeletionRepository(prisma as never, events, journal),
      new PrismaLedgerImportRepository(prisma as never, events),
      new PrismaLedgerWriteRepository(prisma as never, events),
      undefined,
    );

    await repo.reverseTransaction('user-1', 'tx-del');

    expect(paymentDeleteMany).toHaveBeenCalledTimes(1);
  });

  it('deleteTransactionsByTransferGroupId includes transferGroupId on each deleted event', async () => {
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisher;
    const groupId = 'grp-1';
    const rows = [
      {
        id: 'debit-1',
        userId: 'user-1',
        source: 'MANUAL',
        status: 'PENDING',
        type: 'DEBIT',
        amount: 25,
        currency: 'DOP',
        accountId: 'acc-from',
        cardId: null,
        categoryId: null,
        transactionDate: new Date('2026-08-01'),
        transferGroupId: groupId,
      },
      {
        id: 'credit-1',
        userId: 'user-1',
        source: 'MANUAL',
        status: 'PENDING',
        type: 'CREDIT',
        amount: 25,
        currency: 'DOP',
        accountId: 'acc-to',
        cardId: null,
        categoryId: null,
        transactionDate: new Date('2026-08-01'),
        transferGroupId: groupId,
      },
    ];

    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          name: 'same-tx',
          finTransaction: {
            findMany: jest.fn().mockResolvedValue(rows),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
          },
          finReceivablePayment: { findMany: jest.fn().mockResolvedValue([]) },
          finLoanInstallment: { findMany: jest.fn().mockResolvedValue([]) },
          finSavingsGoalContribution: {
            findMany: jest.fn().mockResolvedValue([]),
          },
        };
        return fn(tx);
      }),
    };

    const repo = new PrismaLedgerRepository(
      prisma as never,
      new PrismaLedgerReadRepository(prisma as never),
      events,
      new PrismaLedgerDeletionRepository(prisma as never, events, journal),
      new PrismaLedgerImportRepository(prisma as never, events),
      new PrismaLedgerWriteRepository(prisma as never, events),
      undefined,
    );

    const result = await repo.deleteTransactionsByTransferGroupId(
      'user-1',
      groupId,
    );

    expect(result).toEqual({ count: 2 });
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({
        eventName: FinanceEvents.TRANSACTION_DELETED,
        aggregateId: 'debit-1',
        payload: expect.objectContaining({
          transactionId: 'debit-1',
          transferGroupId: groupId,
          status: 'PENDING',
        }),
      }),
      expect.objectContaining({
        eventName: FinanceEvents.TRANSACTION_DELETED,
        aggregateId: 'credit-1',
        payload: expect.objectContaining({
          transactionId: 'credit-1',
          transferGroupId: groupId,
        }),
      }),
    ]);
  });

  it('deleteTransaction does not enqueue when the row is missing', async () => {
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisher;

    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          finTransaction: {
            findFirst: jest.fn().mockResolvedValue(null),
            deleteMany: jest.fn(),
          },
        };
        return fn(tx);
      }),
    };

    const repo = new PrismaLedgerRepository(
      prisma as never,
      new PrismaLedgerReadRepository(prisma as never),
      events,
      new PrismaLedgerDeletionRepository(prisma as never, events, journal),
      new PrismaLedgerImportRepository(prisma as never, events),
      new PrismaLedgerWriteRepository(prisma as never, events),
      undefined,
    );

    const result = await repo.deleteTransaction('user-1', 'missing');
    expect(result).toEqual({ count: 0 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('confirmTransaction skips balance effects when another request claimed the movement', async () => {
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisher;
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const pending = {
      id: 'tx-1',
      userId: 'user-1',
      status: 'PENDING',
      accountId: 'acc-1',
      cardId: null,
      type: 'DEBIT',
      amount: 50,
      ledgerAmount: 50,
      amountBaseCurrency: 50,
      currency: 'DOP',
      ledgerCurrency: 'DOP',
      exchangeRate: 1,
      categoryId: null,
      transactionDate: new Date('2026-08-01'),
    };
    const confirmed = {
      ...pending,
      status: 'CONFIRMED',
      account: { id: 'acc-1', name: 'Cuenta' },
      card: null,
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          finTransaction: {
            findFirst: jest
              .fn()
              .mockResolvedValueOnce(pending)
              .mockResolvedValueOnce(confirmed),
            updateMany,
          },
        };
        return fn(tx);
      }),
    };

    const repo = new PrismaLedgerRepository(
      prisma as never,
      new PrismaLedgerReadRepository(prisma as never),
      events,
      new PrismaLedgerDeletionRepository(prisma as never, events, journal),
      new PrismaLedgerImportRepository(prisma as never, events),
      new PrismaLedgerWriteRepository(prisma as never, events),
      undefined,
    );

    const confirmedOutcome = await repo.confirmTransaction('user-1', 'tx-1');

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'tx-1', userId: 'user-1', status: 'PENDING' },
      data: { status: 'CONFIRMED' },
    });
    expect(confirmedOutcome?.transaction.status).toBe('CONFIRMED');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('deleteTransaction does not reverse when another request claimed the delete', async () => {
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisher;
    const journalRecord = jest.fn().mockResolvedValue({ id: 'journal-1' });
    const localJournal = {
      record: journalRecord,
      restore: jest.fn(),
    } as unknown as DeletionJournalRepository;
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const deleteMany = jest.fn();
    const existing = {
      id: 'tx-del',
      userId: 'user-1',
      source: 'MANUAL',
      status: 'CONFIRMED',
      type: 'DEBIT',
      amount: 50,
      ledgerAmount: 50,
      amountBaseCurrency: 50,
      currency: 'DOP',
      ledgerCurrency: 'DOP',
      accountId: 'acc-1',
      cardId: null,
      categoryId: null,
      transactionDate: new Date('2026-08-01'),
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          finTransaction: {
            findFirst: jest.fn().mockResolvedValue(existing),
            updateMany,
            deleteMany,
          },
        };
        return fn(tx);
      }),
    };

    const repo = new PrismaLedgerRepository(
      prisma as never,
      new PrismaLedgerReadRepository(prisma as never),
      events,
      new PrismaLedgerDeletionRepository(prisma as never, events, localJournal),
      new PrismaLedgerImportRepository(prisma as never, events),
      new PrismaLedgerWriteRepository(prisma as never, events),
      undefined,
    );

    const deletedOutcome = await repo.deleteTransaction('user-1', 'tx-del');

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'tx-del',
        userId: 'user-1',
        source: 'MANUAL',
        status: 'CONFIRMED',
      },
      data: { status: 'CANCELLED' },
    });
    expect(deletedOutcome).toEqual({ count: 0 });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(journalRecord).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('findTransactions returns one logical row per transfer with the credit counterpart', async () => {
    const debit = {
      id: 'debit-1',
      userId: 'user-1',
      type: 'DEBIT',
      amount: 100,
      ledgerAmount: 100,
      amountBaseCurrency: 100,
      currency: 'DOP',
      ledgerCurrency: 'DOP',
      exchangeRate: 1,
      merchant: null,
      description: null,
      notes: null,
      categoryId: null,
      status: 'CONFIRMED',
      source: 'MANUAL',
      transferGroupId: 'grp-1',
      linkedTransactionId: null,
      transactionDate: new Date('2026-08-01T12:00:00.000Z'),
      createdAt: new Date('2026-08-01T12:00:00.000Z'),
      accountId: 'acc-from',
      cardId: null,
      account: { id: 'acc-from', name: 'Nómina' },
      card: null,
    };
    const credit = {
      ...debit,
      id: 'credit-1',
      type: 'CREDIT',
      accountId: 'acc-to',
      account: { id: 'acc-to', name: 'Ahorros' },
    };
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([debit])
      .mockResolvedValueOnce([credit]);
    const prisma = {
      $transaction: jest.fn(async (ops: Promise<unknown>[]) =>
        Promise.all(ops),
      ),
      finTransaction: {
        findMany,
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const repo = new PrismaLedgerRepository(
      prisma as never,
      new PrismaLedgerReadRepository(prisma as never),
      { enqueue: jest.fn() },
      new PrismaLedgerDeletionRepository(
        prisma as never,
        { enqueue: jest.fn() },
        journal,
      ),
      new PrismaLedgerImportRepository(prisma as never, {
        enqueue: jest.fn(),
      }),
      new PrismaLedgerWriteRepository(prisma as never, { enqueue: jest.fn() }),
      undefined,
    );

    const items = await repo.findTransactions('user-1', { limit: 20 });

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('debit-1');
    expect(items[0]?.transferCounterpart?.id).toBe('credit-1');
    expect(items[0]?.transferCounterpart?.account?.name).toBe('Ahorros');
  });

  it('purgeLedgerForAccount restores CONFIRMED balance including EMAIL txs', async () => {
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisher;
    const finAccountUpdate = jest.fn();
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const emailTx = {
      id: 'tx-email',
      userId: 'user-1',
      source: 'EMAIL',
      status: 'CONFIRMED',
      type: 'DEBIT',
      amount: 40,
      ledgerAmount: 40,
      amountBaseCurrency: 40,
      currency: 'DOP',
      ledgerCurrency: 'DOP',
      accountId: 'acc-1',
      cardId: null,
      categoryId: null,
      transactionDate: new Date('2026-08-01'),
      transferGroupId: null,
    };

    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          name: 'same-tx',
          finAccount: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'acc-1',
              userId: 'user-1',
              currency: 'DOP',
              type: 'CHECKING',
              balance: 100,
            }),
            update: finAccountUpdate,
          },
          finCard: {
            findFirst: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
          },
          finCardBalance: {
            findFirst: jest.fn(),
            update: jest.fn(),
            create: jest.fn(),
          },
          finTransaction: {
            findMany: jest.fn().mockResolvedValue([emailTx]),
            deleteMany,
          },
          finBudget: {
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn(),
          },
        };
        return fn(tx);
      }),
    };

    const repo = new PrismaLedgerRepository(
      prisma as never,
      new PrismaLedgerReadRepository(prisma as never),
      events,
      new PrismaLedgerDeletionRepository(prisma as never, events, journal),
      new PrismaLedgerImportRepository(prisma as never, events),
      new PrismaLedgerWriteRepository(prisma as never, events),
      undefined,
    );

    const result = await repo.purgeLedgerForAccount('user-1', 'acc-1');
    expect(result).toMatchObject({ count: 1 });
    expect(finAccountUpdate).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', id: { in: ['tx-email'] } },
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('purgeLedgerForAccount deletes both legs of a transfer', async () => {
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisher;
    const groupId = 'grp-purge';
    const debit = {
      id: 'debit-p',
      userId: 'user-1',
      source: 'MANUAL',
      status: 'PENDING',
      type: 'DEBIT',
      amount: 25,
      currency: 'DOP',
      accountId: 'acc-from',
      cardId: null,
      categoryId: null,
      transactionDate: new Date('2026-08-01'),
      transferGroupId: groupId,
    };
    const credit = {
      ...debit,
      id: 'credit-p',
      type: 'CREDIT',
      accountId: 'acc-to',
    };
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([debit])
      .mockResolvedValueOnce([debit, credit]);
    const deleteMany = jest.fn().mockResolvedValue({ count: 2 });

    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          finCard: { findMany: jest.fn().mockResolvedValue([]) },
          finTransaction: { findMany, deleteMany },
        };
        return fn(tx);
      }),
    };

    const repo = new PrismaLedgerRepository(
      prisma as never,
      new PrismaLedgerReadRepository(prisma as never),
      events,
      new PrismaLedgerDeletionRepository(prisma as never, events, journal),
      new PrismaLedgerImportRepository(prisma as never, events),
      new PrismaLedgerWriteRepository(prisma as never, events),
      undefined,
    );

    const result = await repo.purgeLedgerForAccount('user-1', 'acc-from');
    expect(result).toMatchObject({ count: 2 });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', id: { in: ['debit-p', 'credit-p'] } },
    });
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it('purgeLedgerForCard is a no-op when the card has no txs', async () => {
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisher;
    const deleteMany = jest.fn();

    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          finTransaction: {
            findMany: jest.fn().mockResolvedValue([]),
            deleteMany,
          },
        };
        return fn(tx);
      }),
    };

    const repo = new PrismaLedgerRepository(
      prisma as never,
      new PrismaLedgerReadRepository(prisma as never),
      events,
      new PrismaLedgerDeletionRepository(prisma as never, events, journal),
      new PrismaLedgerImportRepository(prisma as never, events),
      new PrismaLedgerWriteRepository(prisma as never, events),
      undefined,
    );

    await expect(
      repo.purgeLedgerForCard('user-1', 'card-1'),
    ).resolves.toMatchObject({
      count: 0,
    });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('findLatestCategoryIdByMerchant returns the newest categorized merchant match', async () => {
    const findFirst = jest.fn().mockResolvedValue({ categoryId: 'cat-food' });
    const prisma = {
      finTransaction: { findFirst },
    };
    const repo = new PrismaLedgerRepository(
      prisma as never,
      new PrismaLedgerReadRepository(prisma as never),
      { enqueue: jest.fn() },
      new PrismaLedgerDeletionRepository(
        prisma as never,
        { enqueue: jest.fn() },
        journal,
      ),
      new PrismaLedgerImportRepository(prisma as never, {
        enqueue: jest.fn(),
      }),
      new PrismaLedgerWriteRepository(prisma as never, { enqueue: jest.fn() }),
      undefined,
    );

    await expect(
      repo.findLatestCategoryIdByMerchant('user-1', '  Cafe  '),
    ).resolves.toBe('cat-food');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          status: 'CONFIRMED',
          categoryId: { not: null },
          merchant: { equals: 'Cafe', mode: 'insensitive' },
        }),
      }),
    );
  });

  it('findLatestCategoryIdByMerchant returns null for blank merchant', async () => {
    const findFirst = jest.fn();
    const prisma = { finTransaction: { findFirst } };
    const repo = new PrismaLedgerRepository(
      prisma as never,
      new PrismaLedgerReadRepository(prisma as never),
      { enqueue: jest.fn() },
      new PrismaLedgerDeletionRepository(
        prisma as never,
        { enqueue: jest.fn() },
        journal,
      ),
      new PrismaLedgerImportRepository(prisma as never, {
        enqueue: jest.fn(),
      }),
      new PrismaLedgerWriteRepository(prisma as never, { enqueue: jest.fn() }),
      undefined,
    );
    await expect(
      repo.findLatestCategoryIdByMerchant('user-1', '   '),
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe('PrismaLedgerImportRepository transfer legs', () => {
  it('persists the leg role, transfer group and no category on import', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'tx-leg',
      status: 'PENDING',
      amount: 100,
      source: 'EMAIL',
      accountId: 'acc-1',
      cardId: null,
    });
    const prisma = {
      $transaction: jest.fn(async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          finAccount: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'acc-1',
              userId: 'user-1',
              currency: 'DOP',
              type: 'SAVINGS',
            }),
          },
          finTransaction: { create },
        }),
      ),
    };
    const repo = new PrismaLedgerImportRepository(prisma as never, {
      enqueue: jest.fn(),
    });

    const created = await repo.createImportedTransaction('user-1', {
      accountId: 'acc-1',
      importReference: 'signal-1',
      externalReference: 'ref-1',
      amount: 100,
      currency: 'DOP',
      merchant: null,
      description: 'Transferencia enviada',
      transactionDate: new Date('2026-11-01T00:00:00.000Z'),
      type: 'DEBIT',
      status: 'PENDING',
      transferGroupId: 'group-1',
      categoryId: null,
      legRole: 'SOURCE',
      amounts: {
        amount: 100,
        currency: 'DOP',
        ledgerAmount: 100,
        ledgerCurrency: 'DOP',
        amountBaseCurrency: 100,
        exchangeRate: 1,
      },
    });

    expect(created.id).toBe('tx-leg');
    const createData = (
      create.mock.calls[0][0] as { data: Record<string, unknown> }
    ).data;
    expect(createData).toMatchObject({
      legRole: 'SOURCE',
      transferGroupId: 'group-1',
      source: 'EMAIL',
      cardId: null,
    });
    expect(createData.categoryId).toBeUndefined();
  });
});

describe('PrismaLedgerImportRepository partial reversal', () => {
  it('stores the linked refund and lowers the purchase budget', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'tx-refund',
      status: 'CONFIRMED',
      amount: 40,
      source: 'EMAIL',
      accountId: 'acc-1',
      cardId: null,
    });
    const accountUpdate = jest.fn().mockResolvedValue(undefined);
    const budgetUpdate = jest.fn().mockResolvedValue({
      id: 'budget-1',
      amountSpent: 60,
      amountLimit: 500,
      alertThresholdPct: 80,
    });
    const prisma = {
      $transaction: jest.fn(async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          $queryRaw: jest.fn().mockResolvedValue([
            {
              id: 'original-1',
              status: 'CONFIRMED',
              type: 'DEBIT',
              transfer_group_id: null,
              amount: 100,
              currency: 'DOP',
            },
          ]),
          finAccount: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'acc-1',
              userId: 'user-1',
              currency: 'DOP',
              type: 'SAVINGS',
            }),
            update: accountUpdate,
          },
          finTransaction: {
            create,
            findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValue({
              id: 'tx-refund',
              status: 'CONFIRMED',
              amount: 40,
              type: 'CREDIT',
              source: 'EMAIL',
              accountId: 'acc-1',
              cardId: null,
            }),
            aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
          },
          finBudget: {
            findMany: jest.fn().mockResolvedValue([
              {
                id: 'budget-1',
                amountSpent: 100,
                amountLimit: 500,
                alertThresholdPct: 80,
              },
            ]),
            update: budgetUpdate,
          },
        }),
      ),
    };
    const repo = new PrismaLedgerImportRepository(prisma as never, {
      enqueue: jest.fn(),
    });

    await repo.createImportedTransaction('user-1', {
      accountId: 'acc-1',
      importReference: 'signal-refund',
      amount: 40,
      currency: 'DOP',
      merchant: 'Comercio desconocido',
      description: 'Reverso parcial',
      transactionDate: new Date('2026-11-05T00:00:00.000Z'),
      type: 'CREDIT',
      status: 'CONFIRMED',
      categoryId: 'cat-1',
      linkedTransactionId: 'original-1',
      amounts: {
        amount: 40,
        currency: 'DOP',
        ledgerAmount: 40,
        ledgerCurrency: 'DOP',
        amountBaseCurrency: 40,
        exchangeRate: 1,
      },
    });

    const createData = (
      create.mock.calls[0][0] as { data: Record<string, unknown> }
    ).data;
    expect(createData).toMatchObject({
      type: 'CREDIT',
      linkedTransactionId: 'original-1',
      categoryId: 'cat-1',
    });
    expect(accountUpdate).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { balance: { increment: 40 } },
    });
    expect(budgetUpdate).toHaveBeenCalledWith({
      where: { id: 'budget-1' },
      data: { amountSpent: { increment: -40 } },
    });
  });

  it('rejects a partial reversal whose accumulated total exceeds the original', async () => {
    const create = jest.fn();
    const prisma = {
      $transaction: jest.fn(async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          $queryRaw: jest.fn().mockResolvedValue([
            {
              id: 'original-1',
              status: 'CONFIRMED',
              type: 'DEBIT',
              transfer_group_id: null,
              amount: 100,
              currency: 'DOP',
            },
          ]),
          finTransaction: {
            findFirst: jest.fn().mockResolvedValue(null),
            aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 70 } }),
            create,
          },
        }),
      ),
    };
    const repo = new PrismaLedgerImportRepository(prisma as never, {
      enqueue: jest.fn(),
    });

    await expect(
      repo.createImportedTransaction(
        'user-1',
        partialReversalCommand({ amount: 60, signalId: 'signal-60' }),
      ),
    ).rejects.toBeInstanceOf(PartialReversalExceedsOriginalError);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a repeated partial reversal from the same source email', async () => {
    const create = jest.fn();
    const prisma = {
      $transaction: jest.fn(async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          $queryRaw: jest.fn().mockResolvedValue([
            {
              id: 'original-1',
              status: 'CONFIRMED',
              type: 'DEBIT',
              transfer_group_id: null,
              amount: 100,
              currency: 'DOP',
            },
          ]),
          finTransaction: {
            findFirst: jest.fn().mockResolvedValue({ id: 'prior-credit' }),
            create,
          },
        }),
      ),
    };
    const repo = new PrismaLedgerImportRepository(prisma as never, {
      enqueue: jest.fn(),
    });

    await expect(
      repo.createImportedTransaction(
        'user-1',
        partialReversalCommand({ amount: 25, signalId: 'signal-replay' }),
      ),
    ).rejects.toBeInstanceOf(PartialReversalAlreadyAppliedError);
    expect(create).not.toHaveBeenCalled();
  });
});

function partialReversalCommand({
  amount,
  signalId,
  sourceEmailMessageId = 'email-1',
}: {
  amount: number;
  signalId: string;
  sourceEmailMessageId?: string;
}) {
  return {
    accountId: 'acc-1',
    importReference: signalId,
    amount,
    currency: 'DOP',
    merchant: 'Tienda',
    description: 'Reverso parcial',
    transactionDate: new Date('2026-11-05T00:00:00.000Z'),
    type: 'CREDIT' as const,
    status: 'CONFIRMED' as const,
    categoryId: 'cat-1',
    linkedTransactionId: 'original-1',
    sourceEmailMessageId,
    amounts: {
      amount,
      currency: 'DOP',
      ledgerAmount: amount,
      ledgerCurrency: 'DOP',
      amountBaseCurrency: amount,
      exchangeRate: 1,
    },
  };
}
