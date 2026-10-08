import { WipeFinanceUserDataUseCase } from './wipe-finance-user-data.use-case';

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
    finInstitution: { count: jest.fn(), deleteMany: jest.fn() },
    finCard: { count: jest.fn(), deleteMany: jest.fn() },
    finEmailConnection: { deleteMany: jest.fn() },
  };
  for (const model of Object.values(tx)) {
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
    expect(tx.finCardBalance.updateMany).toHaveBeenCalledWith({
      where: { card: { userId: 'user-1' } },
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
});
