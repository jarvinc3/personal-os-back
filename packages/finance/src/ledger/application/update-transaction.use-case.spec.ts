import { BadRequestException } from '@nestjs/common';
import type { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import type { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { UpdateTransactionUseCase } from './update-transaction.use-case';
import type {
  LedgerRepositoryPort,
  LedgerTransactionRow,
} from './ports/ledger.repository.port';

function tx(
  overrides: Partial<LedgerTransactionRow> = {},
): LedgerTransactionRow {
  return {
    id: 'tx-1',
    userId: 'user-1',
    accountId: 'acc-1',
    cardId: null,
    type: 'CREDIT',
    amount: 10,
    ledgerAmount: 10,
    amountBaseCurrency: 10,
    currency: 'DOP',
    ledgerCurrency: 'DOP',
    exchangeRate: 1,
    merchant: null,
    description: null,
    notes: null,
    categoryId: 'cat-expense',
    status: 'CONFIRMED',
    source: 'MANUAL',
    transferGroupId: null,
    linkedTransactionId: null,
    transactionDate: new Date('2026-08-01'),
    createdAt: new Date('2026-08-01'),
    ...overrides,
  };
}

describe('UpdateTransactionUseCase category type', () => {
  const findTransactionById = jest.fn();
  const updateTransaction = jest.fn();
  const repo = {
    findTransactionById,
    updateTransaction,
  } as unknown as LedgerRepositoryPort;

  const resolveAmounts = {
    execute: jest.fn(),
  } as unknown as ResolveAmountsUseCase;

  const outboxDispatcher = {
    processBatch: jest.fn(),
  } as unknown as FinanceOutboxDispatcher;

  const ownership = {
    assertCategoryVisible: jest.fn(),
    assertCategoryMatchesTransactionType: jest.fn(),
  };

  const useCase = new UpdateTransactionUseCase(
    repo,
    resolveAmounts,
    outboxDispatcher,
    ownership as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findTransactionById.mockResolvedValue(tx());
    updateTransaction.mockResolvedValue({
      transaction: tx(),
      budgetSnapshots: [],
    });
    ownership.assertCategoryVisible.mockResolvedValue({
      id: 'cat-expense',
      type: 'EXPENSE',
    });
  });

  it('allows a legacy CREDIT transaction to keep an EXPENSE category', async () => {
    await useCase.execute('user-1', 'tx-1', { categoryId: 'cat-expense' });

    expect(
      ownership.assertCategoryMatchesTransactionType,
    ).not.toHaveBeenCalled();
    expect(updateTransaction).toHaveBeenCalled();
  });

  it('rejects changing to a category that does not match the transaction type', async () => {
    ownership.assertCategoryVisible.mockResolvedValue({
      id: 'cat-income',
      type: 'INCOME',
    });
    ownership.assertCategoryMatchesTransactionType.mockImplementation(() => {
      throw new BadRequestException(
        'Category type does not match the transaction type',
      );
    });

    await expect(
      useCase.execute('user-1', 'tx-1', { categoryId: 'cat-income' }),
    ).rejects.toThrow(/transaction type/);
    expect(updateTransaction).not.toHaveBeenCalled();
  });
});
