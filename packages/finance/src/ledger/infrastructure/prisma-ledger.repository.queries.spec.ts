import type { PrismaService } from '@personal-os/database';
import type { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';
import { TRANSACTION_LINK_KIND } from '../../shared/domain/transaction-links';
import { EMAIL_DUPLICATE_DATE_TOLERANCE_MS } from '../../shared/domain/email-dedupe';
import { PrismaLedgerReadRepository } from './prisma-ledger-read.repository';
import { PrismaLedgerRepository } from './prisma-ledger.repository';

function createRepository() {
  const prisma = {
    finTransaction: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
    },
    finLoanInstallment: { findFirst: jest.fn() },
    finReceivablePayment: { findFirst: jest.fn() },
    finSavingsGoalContribution: { findFirst: jest.fn() },
    finAccount: { findFirst: jest.fn() },
    finSavingsGoal: { findFirst: jest.fn() },
    finCard: { findFirst: jest.fn() },
    finCardBalance: { findFirst: jest.fn() },
  };

  return {
    prisma,
    repository: new PrismaLedgerRepository(
      prisma as unknown as PrismaService,
      new PrismaLedgerReadRepository(prisma as unknown as PrismaService),
      { enqueue: jest.fn() },
      { record: jest.fn() } as unknown as DeletionJournalRepository,
    ),
  };
}

describe('PrismaLedgerRepository lookups', () => {
  it('finds a transaction owned by the user with its parties and links', async () => {
    const { repository, prisma } = createRepository();

    await repository.findTransactionById('tx-1', 'user-1');

    const query = prisma.finTransaction.findFirst.mock.calls[0][0];
    expect(query.where).toEqual({ id: 'tx-1', userId: 'user-1' });
    expect(query.include).toBeDefined();
  });

  it('clears the duplicate marker without deleting the row', async () => {
    const { repository, prisma } = createRepository();

    await repository.clearPossibleDuplicate('user-1', 'tx-1');

    expect(prisma.finTransaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'tx-1', userId: 'user-1' },
      data: { possibleDuplicateOfId: null },
    });
  });

  it('reads the planning link kind of a transaction', async () => {
    const { repository, prisma } = createRepository();

    await expect(
      repository.findPlanningLinkKind('tx-1', 'user-1'),
    ).resolves.toBeNull();

    prisma.finLoanInstallment.findFirst.mockResolvedValue({ id: 'inst-1' });
    await expect(
      repository.findPlanningLinkKind('tx-1', 'user-1'),
    ).resolves.toBe(TRANSACTION_LINK_KIND.LOAN_INSTALLMENT);

    prisma.finLoanInstallment.findFirst.mockResolvedValue(null);
    prisma.finReceivablePayment.findFirst.mockResolvedValue({ id: 'pay-1' });
    await expect(
      repository.findPlanningLinkKind('tx-1', 'user-1'),
    ).resolves.toBe(TRANSACTION_LINK_KIND.RECEIVABLE_PAYMENT);

    prisma.finReceivablePayment.findFirst.mockResolvedValue(null);
    prisma.finSavingsGoalContribution.findFirst.mockResolvedValue({
      id: 'contrib-1',
    });
    await expect(
      repository.findPlanningLinkKind('tx-1', 'user-1'),
    ).resolves.toBe(TRANSACTION_LINK_KIND.SAVINGS_CONTRIBUTION);
  });

  it('finds the account currency for a user', async () => {
    const { repository, prisma } = createRepository();

    await repository.findAccountById('acc-1', 'user-1');

    expect(prisma.finAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 'acc-1', userId: 'user-1' },
      select: { id: true, currency: true },
    });
  });

  it('returns the savings goal tied to an account', async () => {
    const { repository, prisma } = createRepository();
    prisma.finSavingsGoal.findFirst.mockResolvedValue({ id: 'goal-1' });

    await expect(
      repository.findSavingsGoalIdByAccount('user-1', 'acc-1'),
    ).resolves.toBe('goal-1');
  });

  it('returns null when the account has no savings goal', async () => {
    const { repository, prisma } = createRepository();
    prisma.finSavingsGoal.findFirst.mockResolvedValue(null);

    await expect(
      repository.findSavingsGoalIdByAccount('user-1', 'acc-1'),
    ).resolves.toBeNull();
  });

  it('rejects a balance adjustment with no target or with both targets', async () => {
    const { repository, prisma } = createRepository();

    await expect(
      repository.findBalanceAdjustmentTarget('user-1', {}),
    ).resolves.toBeNull();
    await expect(
      repository.findBalanceAdjustmentTarget('user-1', {
        accountId: 'acc-1',
        cardId: 'card-1',
      }),
    ).resolves.toBeNull();
    expect(prisma.finAccount.findFirst).not.toHaveBeenCalled();
    expect(prisma.finCard.findFirst).not.toHaveBeenCalled();
  });

  it('builds the account balance target with the current balance', async () => {
    const { repository, prisma } = createRepository();
    prisma.finAccount.findFirst.mockResolvedValue({
      id: 'acc-1',
      currency: 'DOP',
      balance: { toString: () => '125.50' },
    });

    await expect(
      repository.findBalanceAdjustmentTarget('user-1', { accountId: 'acc-1' }),
    ).resolves.toEqual({
      accountId: 'acc-1',
      cardId: null,
      currency: 'DOP',
      currentBalance: 125.5,
    });
  });

  it('returns null when the account target does not exist', async () => {
    const { repository, prisma } = createRepository();
    prisma.finAccount.findFirst.mockResolvedValue(null);

    await expect(
      repository.findBalanceAdjustmentTarget('user-1', { accountId: 'acc-1' }),
    ).resolves.toBeNull();
  });

  it('requires a currency for a card balance target', async () => {
    const { repository, prisma } = createRepository();

    await expect(
      repository.findBalanceAdjustmentTarget('user-1', { cardId: 'card-1' }),
    ).resolves.toBeNull();
    expect(prisma.finCard.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a card whose type does not match its account link', async () => {
    const { repository, prisma } = createRepository();
    prisma.finCard.findFirst.mockResolvedValue({
      id: 'card-1',
      type: 'DEBIT',
      accountId: null,
    });

    await expect(
      repository.findBalanceAdjustmentTarget('user-1', {
        cardId: 'card-1',
        currency: 'DOP',
      }),
    ).resolves.toBeNull();
  });

  it('builds the card balance target with a normalized currency', async () => {
    const { repository, prisma } = createRepository();
    prisma.finCard.findFirst.mockResolvedValue({
      id: 'card-1',
      type: 'CREDIT',
      accountId: null,
    });
    prisma.finCardBalance.findFirst.mockResolvedValue({
      balance: { toString: () => '40' },
    });

    await expect(
      repository.findBalanceAdjustmentTarget('user-1', {
        cardId: 'card-1',
        currency: 'usd',
      }),
    ).resolves.toEqual({
      accountId: null,
      cardId: 'card-1',
      currency: 'USD',
      currentBalance: 40,
    });
  });

  it('defaults the card balance to zero without a balance row', async () => {
    const { repository, prisma } = createRepository();
    prisma.finCard.findFirst.mockResolvedValue({
      id: 'card-1',
      type: 'CREDIT',
      accountId: null,
    });
    prisma.finCardBalance.findFirst.mockResolvedValue(null);

    const target = await repository.findBalanceAdjustmentTarget('user-1', {
      cardId: 'card-1',
      currency: 'DOP',
    });

    expect(target?.currentBalance).toBe(0);
  });

  it('finds a transaction by its Gmail message, scoped or not to the user', async () => {
    const { repository, prisma } = createRepository();

    await repository.findTransactionByEmailMessageId('msg-1');
    expect(prisma.finTransaction.findFirst).toHaveBeenLastCalledWith({
      where: { emailMessage: { gmailMessageId: 'msg-1' } },
    });

    await repository.findTransactionByEmailMessageId('msg-1', 'user-1');
    expect(prisma.finTransaction.findFirst).toHaveBeenLastCalledWith({
      where: {
        emailMessage: { gmailMessageId: 'msg-1' },
        userId: 'user-1',
      },
    });
  });

  it('finds the legs of a transfer group ordered by type', async () => {
    const { repository, prisma } = createRepository();

    await repository.findTransactionsByTransferGroupId('grp-1', 'user-1');

    expect(prisma.finTransaction.findMany).toHaveBeenCalledWith({
      where: { transferGroupId: 'grp-1', userId: 'user-1' },
      include: expect.anything(),
      orderBy: { type: 'asc' },
    });
  });

  it('short-circuits an empty transfer group list', async () => {
    const { repository, prisma } = createRepository();

    await expect(
      repository.findTransactionsByTransferGroupIds('user-1', []),
    ).resolves.toEqual([]);
    expect(prisma.finTransaction.findMany).not.toHaveBeenCalled();
  });

  it('finds the legs of several transfer groups in date order', async () => {
    const { repository, prisma } = createRepository();

    await repository.findTransactionsByTransferGroupIds('user-1', [
      'grp-1',
      'grp-2',
    ]);

    expect(prisma.finTransaction.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', transferGroupId: { in: ['grp-1', 'grp-2'] } },
      include: expect.anything(),
      orderBy: [{ transactionDate: 'asc' }, { id: 'asc' }],
    });
  });

  it('searches reverse candidates in a 28 day window', async () => {
    const { repository, prisma } = createRepository();
    const aroundDate = new Date('2026-08-15T12:00:00.000Z');

    await repository.findCandidatesForReverse('user-1', {
      amount: 100,
      currency: 'DOP',
      merchant: 'Cafe',
      aroundDate,
      statuses: ['PENDING'],
    });

    expect(prisma.finTransaction.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        status: { in: ['PENDING'] },
        currency: 'DOP',
        amount: 100,
        transactionDate: {
          gte: new Date('2026-08-01T12:00:00.000Z'),
          lte: new Date('2026-08-29T12:00:00.000Z'),
        },
        merchant: { contains: 'Cafe', mode: 'insensitive' },
      },
      orderBy: { transactionDate: 'desc' },
      take: 10,
    });
  });

  it('defaults reverse candidates to confirmed transactions', async () => {
    const { repository, prisma } = createRepository();

    await repository.findCandidatesForReverse('user-1', {
      amount: 100,
      currency: 'DOP',
      merchant: null,
      aroundDate: new Date('2026-08-15T00:00:00.000Z'),
    });

    const query = prisma.finTransaction.findMany.mock.calls[0][0];
    expect(query.where.status).toEqual({ in: ['CONFIRMED'] });
    expect(query.where.merchant).toBeUndefined();
  });

  it('finds a transaction by external reference', async () => {
    const { repository, prisma } = createRepository();

    await repository.findTransactionByExternalReference('user-1', 'ref-1');

    expect(prisma.finTransaction.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', externalReference: 'ref-1' },
      orderBy: { transactionDate: 'desc' },
    });
  });

  it('looks for duplicates in a 48 hour window', async () => {
    const { repository, prisma } = createRepository();
    const transactionDate = new Date('2026-08-15T12:00:00.000Z');

    await repository.findPossibleDuplicate('user-1', {
      accountId: 'acc-1',
      amount: 50,
      currency: 'DOP',
      type: 'DEBIT',
      transactionDate,
    });

    expect(prisma.finTransaction.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        status: { in: ['PENDING', 'CONFIRMED'] },
        externalReference: null,
        currency: 'DOP',
        amount: 50,
        type: 'DEBIT',
        transactionDate: {
          gte: new Date('2026-08-13T12:00:00.000Z'),
          lte: new Date('2026-08-17T12:00:00.000Z'),
        },
        accountId: 'acc-1',
      },
      orderBy: { transactionDate: 'desc' },
    });
  });

  it('dedupes by external reference when the bank provides one', async () => {
    const { repository, prisma } = createRepository();

    await repository.findDedupeCandidate('user-1', {
      externalReference: 'ref-1',
      amount: 50,
      currency: 'DOP',
      type: 'DEBIT',
      merchant: 'Cafe',
      transactionDate: new Date('2026-08-15T12:00:00.000Z'),
    });

    expect(prisma.finTransaction.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        externalReference: 'ref-1',
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
      orderBy: { transactionDate: 'desc' },
    });
  });

  it('dedupes by amount and merchant within the email tolerance', async () => {
    const { repository, prisma } = createRepository();
    const transactionDate = new Date('2026-08-15T12:00:00.000Z');

    await repository.findDedupeCandidate('user-1', {
      externalReference: null,
      cardId: 'card-1',
      amount: 50,
      currency: 'DOP',
      type: 'DEBIT',
      merchant: 'Cafe',
      transactionDate,
    });

    const query = prisma.finTransaction.findFirst.mock.calls[0][0];
    expect(query.where.transactionDate).toEqual({
      gte: new Date(
        transactionDate.getTime() - EMAIL_DUPLICATE_DATE_TOLERANCE_MS,
      ),
      lte: new Date(
        transactionDate.getTime() + EMAIL_DUPLICATE_DATE_TOLERANCE_MS,
      ),
    });
    expect(query.where.merchant).toEqual({
      equals: 'Cafe',
      mode: 'insensitive',
    });
    expect(query.where.cardId).toBe('card-1');
  });

  it('returns null for a blank merchant when guessing the category', async () => {
    const { repository, prisma } = createRepository();

    await expect(
      repository.findLatestCategoryIdByMerchant('user-1', '   '),
    ).resolves.toBeNull();
    expect(prisma.finTransaction.findFirst).not.toHaveBeenCalled();
  });

  it('returns the last category used for a merchant', async () => {
    const { repository, prisma } = createRepository();
    prisma.finTransaction.findFirst.mockResolvedValue({ categoryId: 'cat-1' });

    await expect(
      repository.findLatestCategoryIdByMerchant('user-1', ' Cafe '),
    ).resolves.toBe('cat-1');
    expect(prisma.finTransaction.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        status: 'CONFIRMED',
        categoryId: { not: null },
        merchant: { equals: 'Cafe', mode: 'insensitive' },
      },
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      select: { categoryId: true },
    });
  });

  it('finds a card for payment with its currencies', async () => {
    const { repository, prisma } = createRepository();
    prisma.finCard.findFirst.mockResolvedValue({
      id: 'card-1',
      type: 'CREDIT',
      balances: [{ currency: 'DOP' }, { currency: 'USD' }],
    });

    await expect(
      repository.findCardForPayment('user-1', 'card-1'),
    ).resolves.toEqual({
      id: 'card-1',
      type: 'CREDIT',
      currencies: ['DOP', 'USD'],
    });
  });

  it('returns null when the payment card does not exist', async () => {
    const { repository, prisma } = createRepository();
    prisma.finCard.findFirst.mockResolvedValue(null);

    await expect(
      repository.findCardForPayment('user-1', 'card-1'),
    ).resolves.toBeNull();
  });
});
