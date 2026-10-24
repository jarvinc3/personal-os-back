import { WipeFinanceUserDataUseCase } from './wipe-finance-user-data.use-case';

function creditRestoreSql(tx: { $executeRaw: jest.Mock }): string {
  return JSON.stringify(tx.$executeRaw.mock.calls[0]);
}

function buildMocks() {
  const tx = {
    finReconciliation: { deleteMany: jest.fn() },
    finTransaction: { deleteMany: jest.fn() },
    finBalanceDrift: { deleteMany: jest.fn() },
    finAccount: { updateMany: jest.fn(), deleteMany: jest.fn() },
    finCardBalance: { updateMany: jest.fn() },
    finCard: { deleteMany: jest.fn() },
    finBudget: { updateMany: jest.fn() },
    finInstitution: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    finLoan: { deleteMany: jest.fn() },
    finEmailSource: { deleteMany: jest.fn() },
    finEmailMessage: { deleteMany: jest.fn() },
    finEmailSyncLog: { deleteMany: jest.fn() },
    $executeRaw: jest.fn().mockResolvedValue(0),
  };
  for (const model of Object.values(tx)) {
    if (typeof model !== 'object' || model === null) {
      continue;
    }
    for (const method of Object.values(model)) {
      method.mockResolvedValue({ count: 0 });
    }
  }
  tx.finInstitution.findMany.mockResolvedValue([{ id: 'inst-1' }]);

  const prisma = {
    finEmailSource: { findMany: jest.fn().mockResolvedValue([]) },
    finMerchant: { findMany: jest.fn().mockResolvedValue([]) },
    finTransaction: { count: jest.fn().mockResolvedValue(4) },
    finReconciliation: { count: jest.fn().mockResolvedValue(1) },
    finBalanceDrift: { count: jest.fn().mockResolvedValue(2) },
    finAccount: { count: jest.fn().mockResolvedValue(3) },
    finCardBalance: { count: jest.fn().mockResolvedValue(2) },
    finCard: { count: jest.fn().mockResolvedValue(1) },
    finInstitution: {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const logos = { deleteCustomLogo: jest.fn().mockResolvedValue(undefined) };
  const gmailSyncQueue = { remove: jest.fn().mockResolvedValue(undefined) };
  return { prisma, tx, logos, gmailSyncQueue };
}

describe('WipeFinanceUserDataUseCase', () => {
  it('wipes transactions without touching merchants, recurring or email', async () => {
    const { prisma, tx, logos, gmailSyncQueue } = buildMocks();
    tx.finTransaction.deleteMany.mockResolvedValue({ count: 4 });
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
      gmailSyncQueue as never,
    );

    await expect(
      useCase.wipeBranches('user-1', ['finance.transactions']),
    ).resolves.toEqual({ 'finance.transactions': 4 });

    expect(tx.finTransaction.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(tx.finAccount.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { balance: 0 },
    });
    expect(tx.finBudget.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { amountSpent: 0 },
    });
    expect(creditRestoreSql(tx)).toContain("c.type = 'CREDIT'");
    expect(tx.finMerchant).toBeUndefined();
    expect(tx.finEmailMessage.deleteMany).not.toHaveBeenCalled();
  });

  it('wipes reconciliations and drifts, keeping the adjustment movements', async () => {
    const { prisma, tx, logos, gmailSyncQueue } = buildMocks();
    tx.finReconciliation.deleteMany.mockResolvedValue({ count: 3 });
    tx.finBalanceDrift.deleteMany.mockResolvedValue({ count: 2 });
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
      gmailSyncQueue as never,
    );

    await expect(
      useCase.wipeBranches('user-1', ['finance.reconciliations']),
    ).resolves.toEqual({ 'finance.reconciliations': 5 });

    expect(tx.finReconciliation.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(tx.finBalanceDrift.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(tx.finTransaction.deleteMany).not.toHaveBeenCalled();
  });

  it('zeroes balances without deleting anything', async () => {
    const { prisma, tx, logos, gmailSyncQueue } = buildMocks();
    tx.finAccount.updateMany.mockResolvedValue({ count: 3 });
    tx.finCardBalance.updateMany.mockResolvedValue({ count: 1 });
    tx.$executeRaw.mockResolvedValue(2);
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
      gmailSyncQueue as never,
    );

    await expect(
      useCase.wipeBranches('user-1', ['finance.balances']),
    ).resolves.toEqual({ 'finance.balances': 6 });

    expect(tx.finAccount.deleteMany).not.toHaveBeenCalled();
    expect(tx.finCard.deleteMany).not.toHaveBeenCalled();
  });

  it('scopes the balances reset to one institution', async () => {
    const { prisma, tx, logos, gmailSyncQueue } = buildMocks();
    tx.finInstitution.findFirst.mockResolvedValue({ id: 'inst-1' });
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
      gmailSyncQueue as never,
    );

    await useCase.wipeBranches('user-1', ['finance.balances'], {
      balanceInstitutionId: 'inst-1',
    });

    expect(tx.finAccount.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', institutionId: 'inst-1' },
      data: { balance: 0 },
    });
    expect(creditRestoreSql(tx)).toContain('inst-1');
  });

  it('rejects a balance scope that is not the user institution', async () => {
    const { prisma, tx, logos, gmailSyncQueue } = buildMocks();
    tx.finInstitution.findFirst.mockResolvedValue(null);
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
      gmailSyncQueue as never,
    );

    await expect(
      useCase.wipeBranches('user-1', ['finance.balances'], {
        balanceInstitutionId: 'inst-other',
      }),
    ).rejects.toMatchObject({
      response: { message: 'Institución no encontrada' },
    });
    expect(tx.finAccount.updateMany).not.toHaveBeenCalled();
  });

  it('deletes the cards with what they drag and keeps accounts', async () => {
    const { prisma, tx, logos, gmailSyncQueue } = buildMocks();
    tx.finCard.deleteMany.mockResolvedValue({ count: 2 });
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
      gmailSyncQueue as never,
    );

    await expect(
      useCase.wipeBranches('user-1', ['finance.cards']),
    ).resolves.toEqual({ 'finance.cards': 2 });

    expect(tx.finCard.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(tx.finAccount.deleteMany).not.toHaveBeenCalled();
    expect(tx.finInstitution.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes the accounts and keeps the cards', async () => {
    const { prisma, tx, logos, gmailSyncQueue } = buildMocks();
    tx.finAccount.deleteMany.mockResolvedValue({ count: 3 });
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
      gmailSyncQueue as never,
    );

    await expect(
      useCase.wipeBranches('user-1', ['finance.accounts']),
    ).resolves.toEqual({ 'finance.accounts': 3 });

    expect(tx.finAccount.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(tx.finCard.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes non-system institutions with their loans and mail sources', async () => {
    const { prisma, tx, logos, gmailSyncQueue } = buildMocks();
    prisma.finInstitution.findMany.mockResolvedValue([
      { customLogoPath: 'custom/user-1/inst-1.png' },
    ]);
    prisma.finMerchant.findMany.mockResolvedValue([]);
    tx.finInstitution.deleteMany.mockResolvedValue({ count: 2 });
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
      gmailSyncQueue as never,
    );

    await expect(
      useCase.wipeBranches('user-1', ['finance.institutions']),
    ).resolves.toEqual({ 'finance.institutions': 2 });

    expect(tx.finInstitution.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isSystem: false },
    });
    expect(tx.finLoan.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', institutionId: { in: ['inst-1'] } },
    });
    expect(logos.deleteCustomLogo).toHaveBeenCalledWith(
      'custom/user-1/inst-1.png',
    );
  });

  it('counts each branch with the same rules as the wipe', async () => {
    const { prisma, logos, gmailSyncQueue } = buildMocks();
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
      gmailSyncQueue as never,
    );

    await expect(
      useCase.countBranches('user-1', [
        'finance.transactions',
        'finance.reconciliations',
        'finance.balances',
        'finance.cards',
        'finance.accounts',
        'finance.institutions',
      ]),
    ).resolves.toEqual({
      'finance.transactions': 4,
      'finance.reconciliations': 3,
      'finance.balances': 5,
      'finance.cards': 1,
      'finance.accounts': 3,
      'finance.institutions': 2,
    });
  });

  it('applies every requested branch in a single transaction', async () => {
    const { prisma, tx, logos, gmailSyncQueue } = buildMocks();
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
      gmailSyncQueue as never,
    );

    await useCase.wipeBranches('user-1', [
      'finance.reconciliations',
      'finance.transactions',
    ]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.finReconciliation.deleteMany).toHaveBeenCalled();
    expect(tx.finTransaction.deleteMany).toHaveBeenCalled();
  });
});
