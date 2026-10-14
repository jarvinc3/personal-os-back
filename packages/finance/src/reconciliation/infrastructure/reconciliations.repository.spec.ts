import { ReconciliationsRepository } from './reconciliations.repository';

const reconciliationRow = {
  id: 'rec-1',
  userId: 'user-1',
  accountId: 'acc-1',
  cardId: null,
  currency: 'DOP',
  asOfDate: new Date('2026-10-15T00:00:00.000Z'),
  appBalance: 10000,
  realBalance: 9950,
  difference: -50,
  note: null,
  createdAt: new Date('2026-10-15T12:00:00.000Z'),
  adjustments: [
    {
      id: 'adj-1',
      reconciliationId: 'rec-1',
      transactionId: 'tx-1',
      kind: 'IMPUESTO_DGII',
      amount: -15,
      transaction: {
        id: 'tx-1',
        accountId: 'acc-1',
        cardId: null,
        type: 'ADJUSTMENT',
        ledgerAmount: -15,
        ledgerCurrency: 'DOP',
      },
    },
    {
      id: 'adj-2',
      reconciliationId: 'rec-1',
      transactionId: 'tx-2',
      kind: 'OTRO',
      amount: -35,
      transaction: {
        id: 'tx-2',
        accountId: 'acc-1',
        cardId: null,
        type: 'ADJUSTMENT',
        ledgerAmount: -35,
        ledgerCurrency: 'DOP',
      },
    },
  ],
};

function build(latestId: string) {
  const updateAccount = jest.fn().mockResolvedValue({});
  const deleteAdjustments = jest.fn().mockResolvedValue({ count: 2 });
  const deleteTransactions = jest.fn().mockResolvedValue({ count: 2 });
  const deleteReconciliation = jest.fn().mockResolvedValue({ id: 'rec-1' });
  const tx = {
    finReconciliation: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(reconciliationRow)
        .mockResolvedValueOnce({ id: latestId }),
      delete: deleteReconciliation,
    },
    finReconciliationAdjustment: { deleteMany: deleteAdjustments },
    finTransaction: { deleteMany: deleteTransactions },
    finAccount: { update: updateAccount },
    finCard: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: unknown) => unknown) =>
      callback(tx),
    ),
  };
  const journal = { record: jest.fn().mockResolvedValue({}) };
  const repo = new ReconciliationsRepository(prisma as never, journal as never);
  return {
    repo,
    journal,
    deleteAdjustments,
    deleteTransactions,
    deleteReconciliation,
    updateAccount,
  };
}

describe('ReconciliationsRepository.delete', () => {
  it('reverses the adjustment balances and journals the close', async () => {
    const fixture = build('rec-1');
    const outcome = await fixture.repo.delete('user-1', 'rec-1');
    expect(outcome).toEqual({ count: 1, notLatest: false });
    expect(fixture.updateAccount).toHaveBeenCalledTimes(2);
    expect(fixture.deleteAdjustments).toHaveBeenCalledWith({
      where: { reconciliationId: 'rec-1' },
    });
    expect(fixture.deleteTransactions).toHaveBeenCalledWith({
      where: { id: { in: ['tx-1', 'tx-2'] } },
    });
    expect(fixture.journal.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: 'reconciliation',
        entityId: 'rec-1',
        snapshot: expect.objectContaining({
          ledgerReversed: ['tx-1', 'tx-2'],
        }),
      }),
    );
  });

  it('refuses to delete when it is not the latest close', async () => {
    const fixture = build('rec-2');
    const outcome = await fixture.repo.delete('user-1', 'rec-1');
    expect(outcome).toEqual({ count: 0, notLatest: true });
    expect(fixture.deleteReconciliation).not.toHaveBeenCalled();
    expect(fixture.journal.record).not.toHaveBeenCalled();
  });
});

describe('ReconciliationsRepository.sumOutgoing', () => {
  it('adds only the movements of the reconciled currency', async () => {
    const aggregate = jest
      .fn()
      .mockResolvedValue({ _sum: { ledgerAmount: 10000 } });
    const prisma = { finTransaction: { aggregate } };
    const repo = new ReconciliationsRepository(prisma as never, {} as never);

    const total = await repo.sumOutgoing(
      'user-1',
      {
        accountId: null,
        cardId: 'card-1',
        cardType: 'CREDIT',
        derivedAccountId: null,
        currency: 'USD',
        name: 'Visa',
        institutionName: 'Popular',
        currentBalance: 0,
      },
      new Date('2026-10-01T00:00:00.000Z'),
      new Date('2026-10-31T00:00:00.000Z'),
    );

    expect(total).toBe(10000);
    expect(aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cardId: 'card-1',
          ledgerCurrency: 'USD',
        }),
      }),
    );
  });
});

describe('ReconciliationsRepository.findTarget', () => {
  it('refuses a debit card because its balance lives in the linked account', async () => {
    const prisma = {
      finCard: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'card-1',
          name: 'Débito',
          type: 'DEBIT',
          accountId: 'acc-1',
          institution: { name: 'BHD' },
        }),
      },
    };
    const repo = new ReconciliationsRepository(prisma as never, {} as never);

    const target = await repo.findTarget('user-1', {
      cardId: 'card-1',
      currency: 'DOP',
    });

    expect(target).toBeNull();
  });
});

describe('ReconciliationsRepository.listProducts', () => {
  it('lists only credit cards as reconcilable products', async () => {
    const cardBalanceFindMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      finAccount: { findMany: jest.fn().mockResolvedValue([]) },
      finCardBalance: { findMany: cardBalanceFindMany },
    };
    const repo = new ReconciliationsRepository(prisma as never, {} as never);

    await repo.listProducts('user-1');

    expect(cardBalanceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { card: { userId: 'user-1', isActive: true, type: 'CREDIT' } },
      }),
    );
  });
});
