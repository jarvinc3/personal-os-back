import { Prisma } from '@personal-os/database';
import type { PrismaService } from '@personal-os/database';
import { IntegrityRepository } from './integrity.repository';

function transactionClient(overrides: Record<string, unknown> = {}) {
  return {
    finAccount: { update: jest.fn().mockResolvedValue({}) },
    finCardBalance: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    finBalanceDrift: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    ...overrides,
  };
}

describe('IntegrityRepository', () => {
  it('sums only CONFIRMED movements when it loads the snapshot', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        accountId: 'acc-1',
        cardId: null,
        type: 'DEBIT',
        ledgerAmount: new Prisma.Decimal(-10),
        ledgerCurrency: 'dop',
      },
    ]);
    const prisma = {
      finAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'acc-1',
            currency: 'DOP',
            balance: new Prisma.Decimal(10),
          },
        ]),
      },
      finCard: { findMany: jest.fn().mockResolvedValue([]) },
      finCardBalance: { findMany: jest.fn().mockResolvedValue([]) },
      finTransaction: { findMany },
    } as unknown as PrismaService;

    const snapshot = await new IntegrityRepository(prisma).loadSnapshot(
      'user-1',
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', status: 'CONFIRMED' },
      }),
    );
    expect(snapshot.movements).toEqual([
      {
        accountId: 'acc-1',
        cardId: null,
        type: 'DEBIT',
        ledgerAmountCents: -1000,
        ledgerCurrency: 'DOP',
      },
    ]);
  });

  it('stores the difference as expected minus stored for a card drift', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'drift-1' });
    const prisma = {
      finBalanceDrift: { create },
    } as unknown as PrismaService;

    await new IntegrityRepository(prisma).createDrift({
      userId: 'user-1',
      target: { cardId: 'card-1', currency: 'DOP' },
      currency: 'usd',
      storedCents: 10000,
      expectedCents: 0,
      detectedAt: new Date('2026-10-20T04:00:00.000Z'),
    });

    const driftData = create.mock.calls[0]?.[0]?.data as Record<
      string,
      unknown
    >;
    expect(driftData).toMatchObject({
      userId: 'user-1',
      accountId: null,
      cardId: 'card-1',
      currency: 'USD',
    });
    expect((driftData.storedBalance as Prisma.Decimal).toString()).toBe('100');
    expect((driftData.expectedBalance as Prisma.Decimal).toString()).toBe('0');
    expect((driftData.difference as Prisma.Decimal).toString()).toBe('-100');
  });

  it('creates the missing card balance row and closes the drift in one transaction', async () => {
    const tx = transactionClient();
    const prisma = {
      $transaction: (run: (client: unknown) => unknown) => run(tx),
    } as unknown as PrismaService;

    await new IntegrityRepository(prisma).correctBalance({
      userId: 'user-1',
      target: { cardId: 'card-1', currency: 'DOP' },
      currency: 'DOP',
      expectedCents: 0,
      now: new Date('2026-10-20T04:00:00.000Z'),
    });

    expect(tx.finCardBalance.create).toHaveBeenCalledWith({
      data: {
        cardId: 'card-1',
        currency: 'DOP',
        balance: expect.anything(),
      },
    });
    expect(tx.finBalanceDrift.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          resolvedAt: null,
          cardId: 'card-1',
          currency: 'DOP',
        }),
      }),
    );
  });

  it('updates the account balance when it corrects an account drift', async () => {
    const tx = transactionClient();
    const prisma = {
      $transaction: (run: (client: unknown) => unknown) => run(tx),
    } as unknown as PrismaService;

    await new IntegrityRepository(prisma).correctBalance({
      userId: 'user-1',
      target: { accountId: 'acc-1' },
      currency: 'DOP',
      expectedCents: 5000,
      now: new Date('2026-10-20T04:00:00.000Z'),
    });

    const updateArgs = tx.finAccount.update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { balance: Prisma.Decimal };
    };
    expect(updateArgs.where).toEqual({ id: 'acc-1' });
    expect(updateArgs.data.balance.toString()).toBe('50');
  });
});
