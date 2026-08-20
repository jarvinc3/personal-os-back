import { AppEvents } from '../../../../core/events/event.constants';
import type { DomainEventPublisherPort } from '../../events/application/ports/domain-event-publisher.port';
import { PrismaLedgerRepository } from './prisma-ledger.repository';

const dopAmounts = {
  amount: 50,
  currency: 'DOP',
  ledgerAmount: 50,
  ledgerCurrency: 'DOP',
  amountBaseCurrency: 50,
  exchangeRate: 1,
};

describe('PrismaLedgerRepository outbox-in-TX', () => {
  it('passes the same transaction client to outbox enqueue on create', async () => {
    const fakeTx = { name: 'tx-client' };
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisherPort;

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
          finTransaction: { create: finTransactionCreate },
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
      events,
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

  it('createTransfer applies balances on both legs and enqueues finance.transfer.created', async () => {
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisherPort;
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
            findFirst: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
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
          finTransaction: { create: finTransactionCreate },
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
      events,
      undefined,
    );

    const result = await repo.createTransfer(
      'user-1',
      {
        fromAccountId: 'acc-from',
        toAccountId: 'acc-to',
        amount: 50,
        transactionDate: '2026-08-01',
      },
      dopAmounts,
      dopAmounts,
    );

    expect(result?.transferGroupId).toBeDefined();
    expect(result?.debit.id).toBe('debit-1');
    expect(result?.credit.id).toBe('credit-1');
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
        AppEvents.FINANCE_TRANSFER_CREATED,
    );
    expect(transferEnqueue).toBeDefined();
    expect(transferEnqueue?.[0]).toEqual(
      expect.objectContaining({
        eventName: AppEvents.FINANCE_TRANSFER_CREATED,
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
});
