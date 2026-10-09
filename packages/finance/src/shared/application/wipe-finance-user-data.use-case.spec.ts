import { WipeFinanceUserDataUseCase } from './wipe-finance-user-data.use-case';

function creditRestoreSql(tx: { $executeRaw: jest.Mock }): string {
  return JSON.stringify(tx.$executeRaw.mock.calls[0]);
}

function buildMocks() {
  const tx = {
    finTransaction: { deleteMany: jest.fn() },
    finEmailMessage: { deleteMany: jest.fn() },
    finEmailSyncLog: { deleteMany: jest.fn() },
    finRecurringPattern: { deleteMany: jest.fn() },
    finAccount: {
      updateMany: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
    finCardBalance: { updateMany: jest.fn() },
    finBudget: { updateMany: jest.fn(), deleteMany: jest.fn() },
    finSavingsGoal: { deleteMany: jest.fn() },
    finLoan: { deleteMany: jest.fn() },
    finReceivable: { deleteMany: jest.fn() },
    finCategory: { deleteMany: jest.fn() },
    finInstitution: {
      count: jest.fn(),
      deleteMany: jest.fn(),
      findFirst: jest.fn(),
    },
    finCard: { count: jest.fn(), deleteMany: jest.fn() },
    finEmailConnection: { deleteMany: jest.fn() },
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
  tx.finAccount.count.mockResolvedValue(0);
  tx.finCard.count.mockResolvedValue(0);
  tx.finInstitution.count.mockResolvedValue(0);

  const prisma = {
    finEmailSource: { findMany: jest.fn().mockResolvedValue([]) },
    finInstitution: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const logos = { deleteCustomLogo: jest.fn().mockResolvedValue(undefined) };
  const gmailSyncQueue = { remove: jest.fn().mockResolvedValue(undefined) };
  return { prisma, tx, logos, gmailSyncQueue };
}

describe('WipeFinanceUserDataUseCase', () => {
  it('empties the ledger without touching catalog rows', async () => {
    const { prisma, tx, logos, gmailSyncQueue } = buildMocks();
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
      gmailSyncQueue as never,
    );

    await useCase.execute('user-1', ['finance.ledger']);

    expect(tx.finTransaction.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(tx.finRecurringPattern.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(tx.finAccount.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { balance: 0 },
    });
    expect(creditRestoreSql(tx)).toContain('credit_limit');
    expect(creditRestoreSql(tx)).toContain('user-1');
    expect(tx.finCardBalance.updateMany).toHaveBeenCalledWith({
      where: { card: { userId: 'user-1', type: 'DEBIT' } },
      data: { balance: 0 },
    });
    expect(tx.finBudget.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { amountSpent: 0 },
    });
    expect(tx.finInstitution.deleteMany).not.toHaveBeenCalled();
    expect(tx.finEmailConnection.deleteMany).not.toHaveBeenCalled();
  });

  it('never touches system categories', async () => {
    const { prisma, tx, logos } = buildMocks();
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
    );

    await useCase.execute('user-1', ['finance.categories']);

    expect(tx.finCategory.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isSystem: false },
    });
  });

  it('counts and deletes the whole catalog', async () => {
    const { prisma, tx, logos } = buildMocks();
    tx.finInstitution.count.mockResolvedValue(2);
    tx.finAccount.count.mockResolvedValue(3);
    tx.finCard.count.mockResolvedValue(1);
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
    );

    const counts = await useCase.execute('user-1', ['finance.catalog']);

    expect(tx.finInstitution.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(tx.finAccount.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(tx.finCard.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(counts).toMatchObject({
      institutions: 2,
      accounts: 3,
      cards: 1,
    });
  });

  it('cancels queued Gmail sync jobs for the user sources', async () => {
    const { prisma, logos, gmailSyncQueue } = buildMocks();
    prisma.finEmailSource.findMany.mockResolvedValue([{ id: 'src-1' }]);
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
      gmailSyncQueue as never,
    );

    await useCase.execute('user-1', ['finance.ledger']);

    expect(gmailSyncQueue.remove).toHaveBeenCalledWith('gmail-sync-src-1');
  });

  it('deletes custom logos best-effort after the transaction', async () => {
    const { prisma, logos } = buildMocks();
    prisma.finInstitution.findMany.mockResolvedValue([
      { customLogoPath: 'custom/user-1/inst-1.png' },
    ]);
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
    );

    await useCase.execute('user-1', ['finance.catalog']);

    expect(logos.deleteCustomLogo).toHaveBeenCalledWith(
      'custom/user-1/inst-1.png',
    );
  });

  it('hard-deletes email connections', async () => {
    const { prisma, tx, logos } = buildMocks();
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
    );

    await useCase.execute('user-1', ['finance.emailConnections']);

    expect(tx.finEmailConnection.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });

  it('zeros accounts and restores credit cards without deleting movements', async () => {
    const { prisma, tx, logos } = buildMocks();
    tx.finAccount.updateMany.mockResolvedValue({ count: 2 });
    tx.$executeRaw.mockResolvedValue(1);
    tx.finCardBalance.updateMany.mockResolvedValue({ count: 2 });
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
    );

    const counts = await useCase.execute('user-1', ['finance.balances']);

    expect(tx.finTransaction.deleteMany).not.toHaveBeenCalled();
    expect(tx.finAccount.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { balance: 0 },
    });
    expect(creditRestoreSql(tx)).toContain('credit_limit');
    expect(creditRestoreSql(tx)).toContain('user-1');
    expect(tx.finCardBalance.updateMany).toHaveBeenCalledWith({
      where: { card: { userId: 'user-1', type: 'DEBIT' } },
      data: { balance: 0 },
    });
    expect(counts).toMatchObject({ accountBalances: 2, cardBalances: 3 });
  });

  it('zeros balances for one institution and rejects an unknown one', async () => {
    const { prisma, tx, logos } = buildMocks();
    tx.finInstitution.findFirst.mockResolvedValue({ id: 'inst-1' });
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
    );

    await useCase.execute('user-1', ['finance.balances'], {
      balanceInstitutionId: 'inst-1',
    });

    expect(tx.finAccount.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', institutionId: 'inst-1' },
      data: { balance: 0 },
    });
    expect(creditRestoreSql(tx)).toContain('institution_id');
    expect(creditRestoreSql(tx)).toContain('inst-1');
    expect(tx.finCardBalance.updateMany).toHaveBeenCalledWith({
      where: {
        card: { userId: 'user-1', institutionId: 'inst-1', type: 'DEBIT' },
      },
      data: { balance: 0 },
    });

    tx.finInstitution.findFirst.mockResolvedValue(null);
    await expect(
      useCase.execute('user-1', ['finance.balances'], {
        balanceInstitutionId: 'missing',
      }),
    ).rejects.toThrow('Institution not found');
  });
});
