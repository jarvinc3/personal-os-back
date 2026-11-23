import type { DomainEventRelay } from '@personal-os/contracts';
import { BadRequestException } from '@nestjs/common';
import type { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import type { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { CreateTransactionUseCase } from './create-transaction.use-case';
import type { LedgerWriteRepositoryPort } from './ports/ledger-write.repository.port';
import type { LedgerQueryRepositoryPort } from './ports/ledger-query.repository.port';

describe('CreateTransactionUseCase', () => {
  const createTransaction = jest.fn();
  const findAccountById = jest
    .fn()
    .mockResolvedValue({ id: 'acc-1', currency: 'DOP' });
  const repo = {
    createTransaction,
    findAccountById,
  } as unknown as LedgerWriteRepositoryPort & LedgerQueryRepositoryPort;

  const resolveExecute = jest.fn().mockResolvedValue({
    amount: 10,
    currency: 'DOP',
    ledgerAmount: 10,
    ledgerCurrency: 'DOP',
    amountBaseCurrency: 10,
    exchangeRate: 1,
  });
  const resolveAmounts = {
    execute: resolveExecute,
  } as unknown as ResolveAmountsUseCase;

  const wake = jest.fn();
  const relay = {
    wake,
  } as unknown as DomainEventRelay;

  const baseCurrencyExecute = jest.fn().mockResolvedValue('DOP');
  const baseCurrency = {
    execute: baseCurrencyExecute,
  } as unknown as ResolveUserBaseCurrencyUseCase;

  const ownership = {
    assertCategoryVisible: jest.fn(),
    assertCategoryMatchesTransactionType: jest.fn(),
  };

  const useCase = new CreateTransactionUseCase(
    repo,
    repo,
    resolveAmounts,
    baseCurrency,
    relay,
    ownership as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    createTransaction.mockResolvedValue({
      transaction: {
        id: 'tx-1',
        accountId: 'acc-1',
        cardId: null,
        type: 'DEBIT',
        amount: 10,
        ledgerAmount: 10,
        amountBaseCurrency: 10,
        currency: 'DOP',
        ledgerCurrency: 'DOP',
        exchangeRate: 1,
        merchant: null,
        description: null,
        notes: null,
        categoryId: null,
        status: 'CONFIRMED',
        source: 'AI',
        transferGroupId: null,
        linkedTransactionId: null,
        transactionDate: new Date('2026-08-01'),
        createdAt: new Date('2026-08-01'),
        userId: 'user-1',
      },
      budgetSnapshots: [],
    });
  });

  it('resolves amounts, creates via repository, and wakes outbox', async () => {
    const command = {
      type: 'DEBIT' as const,
      amount: 10,
      transactionDate: '2026-08-01',
      accountId: 'acc-1',
    };

    const result = await useCase.execute('user-1', command, 'AI');

    expect(result.id).toBe('tx-1');
    expect(resolveExecute).toHaveBeenCalled();
    expect(createTransaction.mock.calls[0]?.[0]?.userId).toBe('user-1');
    expect(createTransaction.mock.calls[0]?.[0]?.source).toBe('AI');
    expect(wake).toHaveBeenCalled();
  });

  it('defaults the transaction currency and base to the user base currency', async () => {
    baseCurrencyExecute.mockResolvedValueOnce('USD');

    await useCase.execute(
      'user-1',
      {
        type: 'DEBIT',
        amount: 10,
        transactionDate: '2026-08-01',
        accountId: 'acc-1',
      },
      'MANUAL',
    );

    expect(resolveExecute).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'USD', baseCurrency: 'USD' }),
    );
  });

  it('throws when repository returns null target', async () => {
    createTransaction.mockResolvedValueOnce(null);
    await expect(
      useCase.execute(
        'user-1',
        {
          type: 'DEBIT',
          amount: 1,
          transactionDate: '2026-08-01',
          accountId: 'missing',
        },
        'MANUAL',
      ),
    ).rejects.toThrow(/exactly one/);
  });

  it('rejects a DEBIT transaction with an INCOME category', async () => {
    ownership.assertCategoryVisible.mockResolvedValue({
      id: 'cat-1',
      type: 'INCOME',
    });
    ownership.assertCategoryMatchesTransactionType.mockImplementation(() => {
      throw new BadRequestException(
        'Category type does not match the transaction type',
      );
    });

    await expect(
      useCase.execute('user-1', {
        type: 'DEBIT',
        amount: 1,
        transactionDate: '2026-08-01',
        accountId: 'acc-1',
        categoryId: 'cat-1',
      }),
    ).rejects.toThrow(/transaction type/);
    expect(createTransaction).not.toHaveBeenCalled();
  });
});
