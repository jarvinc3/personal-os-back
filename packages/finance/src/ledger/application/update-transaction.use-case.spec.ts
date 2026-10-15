import { BadRequestException } from '@nestjs/common';
import type { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import type { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import type { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
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

  const baseCurrency = {
    execute: jest.fn().mockResolvedValue('DOP'),
  } as unknown as ResolveUserBaseCurrencyUseCase;

  const outboxDispatcher = {
    processBatch: jest.fn(),
  } as unknown as FinanceOutboxDispatcher;

  const ownership = {
    assertCategoryVisible: jest.fn(),
    assertCategoryMatchesTransactionType: jest.fn(),
  };

  const merchants = {
    resolve: jest.fn().mockResolvedValue({ id: 'merchant-1' }),
  };

  const useCase = new UpdateTransactionUseCase(
    repo,
    resolveAmounts,
    baseCurrency,
    outboxDispatcher,
    ownership as never,
    merchants as never,
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

  it('locks monetary edits once the movement is CONFIRMED', async () => {
    findTransactionById.mockResolvedValue(tx({ status: 'CONFIRMED' }));

    await expect(
      useCase.execute('user-1', 'tx-1', { amount: 25 }),
    ).rejects.toMatchObject({ response: { code: 'TRANSACTION_LOCKED' } });
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it('allows metadata edits on a CONFIRMED movement', async () => {
    findTransactionById.mockResolvedValue(tx({ status: 'CONFIRMED' }));

    await useCase.execute('user-1', 'tx-1', {
      merchant: 'Colmado',
      notes: 'nota',
    });

    expect(updateTransaction).toHaveBeenCalled();
  });

  it('keeps a REVERSED movement immutable except notes and category', async () => {
    findTransactionById.mockResolvedValue(tx({ status: 'REVERSED' }));

    await expect(
      useCase.execute('user-1', 'tx-1', { type: 'DEBIT' }),
    ).rejects.toMatchObject({ response: { code: 'TRANSACTION_IMMUTABLE' } });
    expect(updateTransaction).not.toHaveBeenCalled();

    await useCase.execute('user-1', 'tx-1', { notes: 'corrección' });
    expect(updateTransaction).toHaveBeenCalled();
  });

  it('allows full edits while the movement is PENDING', async () => {
    findTransactionById.mockResolvedValue(tx({ status: 'PENDING' }));

    await useCase.execute('user-1', 'tx-1', { merchant: 'Farmacia' });

    expect(updateTransaction).toHaveBeenCalled();
  });
});
