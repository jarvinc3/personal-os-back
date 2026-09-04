import type { ConfigService } from '@nestjs/config';
import type { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import type { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { CreateTransactionUseCase } from './create-transaction.use-case';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

describe('CreateTransactionUseCase', () => {
  const createTransaction = jest.fn();
  const findAccountById = jest.fn().mockResolvedValue({ id: 'acc-1', currency: 'DOP' });
  const repo = {
    createTransaction,
    findAccountById,
  } as unknown as LedgerRepositoryPort;

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

  const processBatch = jest.fn();
  const outboxDispatcher = {
    processBatch,
  } as unknown as FinanceOutboxDispatcher;

  const config = {
    get: jest.fn().mockReturnValue('DOP'),
  } as unknown as ConfigService;

  const ownership = {
    assertCategoryVisible: jest.fn(),
  };

  const useCase = new CreateTransactionUseCase(
    repo,
    resolveAmounts,
    config as never,
    outboxDispatcher,
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
    expect(createTransaction.mock.calls[0]?.[0]).toBe('user-1');
    expect(createTransaction.mock.calls[0]?.[3]).toBe('AI');
    expect(processBatch).toHaveBeenCalled();
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
});
