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
    finSubscription: { deleteMany: jest.fn(), count: jest.fn() },
    finSubscriptionPayment: { deleteMany: jest.fn() },
    finSubscriptionAlertDismissal: { deleteMany: jest.fn() },
    finRecurringPattern: { deleteMany: jest.fn() },
    finMerchant: { deleteMany: jest.fn() },
    finStatementImport: { deleteMany: jest.fn() },
    finCardStatement: { deleteMany: jest.fn() },
    finSavingsGoal: { deleteMany: jest.fn() },
    finReceivable: { deleteMany: jest.fn() },
    finBudget: { updateMany: jest.fn(), deleteMany: jest.fn() },
    finCategory: { deleteMany: jest.fn() },
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
    finSubscription: { count: jest.fn().mockResolvedValue(3) },
    finRecurringPattern: { count: jest.fn().mockResolvedValue(2) },
    finMerchant: {
      count: jest.fn().mockResolvedValue(5),
      findMany: jest.fn().mockResolvedValue([]),
    },
    finStatementImport: { count: jest.fn().mockResolvedValue(2) },
    finCardStatement: { count: jest.fn().mockResolvedValue(1) },
    finLoan: { count: jest.fn().mockResolvedValue(1) },
    finSavingsGoal: { count: jest.fn().mockResolvedValue(2) },
    finReceivable: { count: jest.fn().mockResolvedValue(2) },
    finBudget: { count: jest.fn().mockResolvedValue(3) },
    finCategory: { count: jest.fn().mockResolvedValue(4) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const logos = { deleteCustomLogo: jest.fn().mockResolvedValue(undefined) };
  return { prisma, tx, logos };
}

describe('WipeFinanceUserDataUseCase', () => {
  it('wipes transactions without touching merchants, recurring or email', async () => {
    const { prisma, tx, logos } = buildMocks();
    tx.finTransaction.deleteMany.mockResolvedValue({ count: 4 });
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
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
    expect(tx.finMerchant.deleteMany).not.toHaveBeenCalled();
  });

  it('wipes reconciliations and drifts, keeping the adjustment movements', async () => {
    const { prisma, tx, logos } = buildMocks();
    tx.finReconciliation.deleteMany.mockResolvedValue({ count: 3 });
    tx.finBalanceDrift.deleteMany.mockResolvedValue({ count: 2 });
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
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
    const { prisma, tx, logos } = buildMocks();
    tx.finAccount.updateMany.mockResolvedValue({ count: 3 });
    tx.finCardBalance.updateMany.mockResolvedValue({ count: 1 });
    tx.$executeRaw.mockResolvedValue(2);
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
    );

    await expect(
      useCase.wipeBranches('user-1', ['finance.balances']),
    ).resolves.toEqual({ 'finance.balances': 6 });

    expect(tx.finAccount.deleteMany).not.toHaveBeenCalled();
    expect(tx.finCard.deleteMany).not.toHaveBeenCalled();
  });

  it('scopes the balances reset to one institution', async () => {
    const { prisma, tx, logos } = buildMocks();
    tx.finInstitution.findFirst.mockResolvedValue({ id: 'inst-1' });
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
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
    const { prisma, tx, logos } = buildMocks();
    tx.finInstitution.findFirst.mockResolvedValue(null);
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
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

  it('deletes the credit cards with what they drag and keeps debit cards and accounts', async () => {
    const { prisma, tx, logos } = buildMocks();
    tx.finCard.deleteMany.mockResolvedValue({ count: 2 });
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
    );

    await expect(
      useCase.wipeBranches('user-1', ['finance.cards']),
    ).resolves.toEqual({ 'finance.cards': 2 });

    expect(tx.finCard.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', type: 'CREDIT' },
    });
    expect(tx.finAccount.deleteMany).not.toHaveBeenCalled();
    expect(tx.finInstitution.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes the debit cards and keeps the credit cards', async () => {
    const { prisma, tx, logos } = buildMocks();
    tx.finCard.deleteMany.mockResolvedValue({ count: 1 });
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
    );

    await expect(
      useCase.wipeBranches('user-1', ['finance.debitCards']),
    ).resolves.toEqual({ 'finance.debitCards': 1 });

    expect(tx.finCard.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', type: 'DEBIT' },
    });
    expect(tx.finAccount.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes the accounts and keeps the cards', async () => {
    const { prisma, tx, logos } = buildMocks();
    tx.finAccount.deleteMany.mockResolvedValue({ count: 3 });
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
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
    const { prisma, tx, logos } = buildMocks();
    prisma.finInstitution.findMany.mockResolvedValue([
      { customLogoPath: 'custom/user-1/inst-1.png' },
    ]);
    prisma.finMerchant.findMany.mockResolvedValue([]);
    tx.finInstitution.deleteMany.mockResolvedValue({ count: 2 });
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
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
    const { prisma, logos } = buildMocks();
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
    );

    await expect(
      useCase.countBranches('user-1', [
        'finance.transactions',
        'finance.reconciliations',
        'finance.balances',
        'finance.cards',
        'finance.debitCards',
        'finance.accountImports',
        'finance.accounts',
        'finance.institutions',
      ]),
    ).resolves.toEqual({
      'finance.transactions': 4,
      'finance.reconciliations': 3,
      'finance.balances': 5,
      'finance.cards': 1,
      'finance.debitCards': 1,
      'finance.accountImports': 2,
      'finance.accounts': 3,
      'finance.institutions': 2,
    });
    expect(prisma.finStatementImport.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', accountId: { not: null } },
    });
  });

  it('applies every requested branch in a single transaction', async () => {
    const { prisma, tx, logos } = buildMocks();
    const useCase = new WipeFinanceUserDataUseCase(
      prisma as never,
      logos as never,
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

describe('WipeFinanceUserDataUseCase rest of the branches', () => {
  function buildUseCase() {
    const mocks = buildMocks();
    const useCase = new WipeFinanceUserDataUseCase(
      mocks.prisma as never,
      mocks.logos as never,
    );
    return { ...mocks, useCase };
  }

  it('deletes subscriptions with their payments and dismissed alerts', async () => {
    const { tx, useCase } = buildUseCase();
    tx.finSubscription.deleteMany.mockResolvedValue({ count: 3 });

    await expect(
      useCase.wipeBranches('user-1', ['finance.subscriptions']),
    ).resolves.toEqual({ 'finance.subscriptions': 3 });

    expect(tx.finSubscriptionPayment.deleteMany).toHaveBeenCalled();
    expect(tx.finSubscriptionAlertDismissal.deleteMany).toHaveBeenCalled();
    expect(tx.finSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });

  it('deletes only the detected recurring patterns', async () => {
    const { tx, useCase } = buildUseCase();
    tx.finRecurringPattern.deleteMany.mockResolvedValue({ count: 2 });

    await expect(
      useCase.wipeBranches('user-1', ['finance.recurring']),
    ).resolves.toEqual({ 'finance.recurring': 2 });

    expect(tx.finRecurringPattern.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(tx.finSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes the merchants and leaves the movement text alone', async () => {
    const { prisma, tx, logos, useCase } = buildUseCase();
    prisma.finMerchant.findMany.mockResolvedValue([
      { customLogoPath: 'custom/user-1/merchant-1.png' },
    ]);
    tx.finMerchant.deleteMany.mockResolvedValue({ count: 5 });

    await expect(
      useCase.wipeBranches('user-1', ['finance.merchants']),
    ).resolves.toEqual({ 'finance.merchants': 5 });

    expect(tx.finMerchant.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(tx.finTransaction.deleteMany).not.toHaveBeenCalled();
    expect(logos.deleteCustomLogo).toHaveBeenCalledWith(
      'custom/user-1/merchant-1.png',
    );
  });

  it('deletes the card statements with the imports not billed from an account', async () => {
    const { tx, useCase } = buildUseCase();
    tx.finStatementImport.deleteMany.mockResolvedValue({ count: 2 });
    tx.finCardStatement.deleteMany.mockResolvedValue({ count: 1 });

    await expect(
      useCase.wipeBranches('user-1', ['finance.statements']),
    ).resolves.toEqual({ 'finance.statements': 3 });

    expect(tx.finStatementImport.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', accountId: null },
    });
    expect(tx.finCardStatement.deleteMany).toHaveBeenCalledWith({
      where: { card: { userId: 'user-1' } },
    });
    expect(tx.finCard.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes only the statement imports billed from an account', async () => {
    const { tx, useCase } = buildUseCase();
    tx.finStatementImport.deleteMany.mockResolvedValue({ count: 4 });

    await expect(
      useCase.wipeBranches('user-1', ['finance.accountImports']),
    ).resolves.toEqual({ 'finance.accountImports': 4 });

    expect(tx.finStatementImport.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', accountId: { not: null } },
    });
    expect(tx.finCardStatement.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes loans, goals, receivables and budgets on their own', async () => {
    const { tx, useCase } = buildUseCase();
    tx.finLoan.deleteMany.mockResolvedValue({ count: 1 });

    await expect(
      useCase.wipeBranches('user-1', ['finance.loans']),
    ).resolves.toEqual({ 'finance.loans': 1 });

    expect(tx.finSavingsGoal.deleteMany).not.toHaveBeenCalled();
    expect(tx.finReceivable.deleteMany).not.toHaveBeenCalled();
    expect(tx.finBudget.deleteMany).not.toHaveBeenCalled();
    expect(tx.finTransaction.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes the own categories and keeps the system ones', async () => {
    const { tx, useCase } = buildUseCase();
    tx.finCategory.deleteMany.mockResolvedValue({ count: 4 });

    await expect(
      useCase.wipeBranches('user-1', ['finance.categories']),
    ).resolves.toEqual({ 'finance.categories': 4 });

    expect(tx.finCategory.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isSystem: false },
    });
    expect(tx.finTransaction.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects retired Gmail data branches instead of silently ignoring them', async () => {
    const { useCase } = buildUseCase();

    await expect(
      useCase.wipeBranches('user-1', ['finance.emailMessages']),
    ).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      useCase.countBranches('user-1', ['finance.emailConnections']),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('counts each new branch with the same rules as the wipe', async () => {
    const { useCase } = buildUseCase();

    await expect(
      useCase.countBranches('user-1', [
        'finance.subscriptions',
        'finance.recurring',
        'finance.merchants',
        'finance.statements',
        'finance.accountImports',
        'finance.loans',
        'finance.savingsGoals',
        'finance.receivables',
        'finance.budgets',
        'finance.categories',
      ]),
    ).resolves.toEqual({
      'finance.subscriptions': 3,
      'finance.recurring': 2,
      'finance.merchants': 5,
      'finance.statements': 3,
      'finance.accountImports': 2,
      'finance.loans': 1,
      'finance.savingsGoals': 2,
      'finance.receivables': 2,
      'finance.budgets': 3,
      'finance.categories': 4,
    });
  });
});
