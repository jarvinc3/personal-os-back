import type { DomainEventPublisherPort } from '../../events/application/ports/domain-event-publisher.port';
import { PrismaLedgerRepository } from './prisma-ledger.repository';

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
});
