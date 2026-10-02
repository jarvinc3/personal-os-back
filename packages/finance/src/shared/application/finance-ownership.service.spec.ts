import { BadRequestException, ConflictException } from '@nestjs/common';
import { FinanceOwnershipService } from './finance-ownership.service';

function prismaMock() {
  return {
    finInstitution: { findFirst: jest.fn() },
    finAccount: { findFirst: jest.fn(), count: jest.fn() },
    finCard: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    finCategory: { findFirst: jest.fn() },
    finEmailSource: { count: jest.fn() },
    finLoan: { count: jest.fn() },
  };
}

describe('FinanceOwnershipService', () => {
  const prisma = prismaMock();
  const service = new FinanceOwnershipService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a category owned by another user', async () => {
    prisma.finCategory.findFirst.mockResolvedValue(null);
    await expect(
      service.assertCategoryVisible('user-1', 'cat-other'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a parent that would create a cycle', async () => {
    prisma.finCategory.findFirst
      .mockResolvedValueOnce({
        id: 'parent',
        userId: 'user-1',
        type: 'EXPENSE',
      })
      .mockResolvedValueOnce({ type: 'EXPENSE' })
      .mockResolvedValueOnce({ parentId: 'child' });

    await expect(
      service.assertParentCategory('user-1', 'parent', 'child'),
    ).rejects.toThrow(/cycle/i);
  });

  it('rejects a parent of a different type', async () => {
    prisma.finCategory.findFirst.mockResolvedValue({
      id: 'parent',
      userId: 'user-1',
      type: 'EXPENSE',
    });

    await expect(
      service.assertParentCategory('user-1', 'parent', undefined, 'INCOME'),
    ).rejects.toThrow(/same type/i);
  });

  it('rejects a category type that does not match the transaction', () => {
    expect(() =>
      service.assertCategoryMatchesTransactionType({ type: 'INCOME' }, 'DEBIT'),
    ).toThrow(/transaction type/i);
  });

  it('rejects income categories for budgets', async () => {
    prisma.finCategory.findFirst.mockResolvedValue({
      id: 'cat-1',
      userId: 'user-1',
      type: 'INCOME',
    });

    await expect(
      service.assertExpenseCategory('user-1', 'cat-1'),
    ).rejects.toThrow(/expense category/i);
  });

  it('requires debit cards to use an account from the same institution', async () => {
    prisma.finAccount.findFirst.mockResolvedValue({
      id: 'acc-1',
      userId: 'user-1',
      institutionId: 'inst-other',
    });

    await expect(
      service.assertDebitAccountAlignment({
        userId: 'user-1',
        accountId: 'acc-1',
        institutionId: 'inst-1',
      }),
    ).rejects.toThrow(/same institution/i);
  });

  it('blocks changing account institution while debit cards remain elsewhere', async () => {
    prisma.finCard.findMany.mockResolvedValue([
      { id: 'card-1', institutionId: 'inst-1', name: 'Débito' },
    ]);

    await expect(
      service.assertAccountInstitutionChangeAllowed({
        userId: 'user-1',
        accountId: 'acc-1',
        nextInstitutionId: 'inst-2',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks archiving an institution with active accounts', async () => {
    prisma.finAccount.count.mockResolvedValue(1);
    prisma.finCard.count.mockResolvedValue(0);
    prisma.finEmailSource.count.mockResolvedValue(0);
    prisma.finLoan.count.mockResolvedValue(0);

    await expect(
      service.assertInstitutionCanArchive('user-1', 'inst-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        dependents: {
          accounts: 1,
          cards: 0,
          emailSources: 0,
          loans: 0,
        },
      }),
    });
  });
});
