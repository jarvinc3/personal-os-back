import type { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import type { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import type { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { UpdateTransferUseCase } from './update-transfer.use-case';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

function leg(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    accountId: 'a1',
    cardId: null,
    type: 'DEBIT',
    amount: 50,
    ledgerAmount: 50,
    amountBaseCurrency: 50,
    currency: 'DOP',
    ledgerCurrency: 'DOP',
    exchangeRate: 1,
    merchant: null,
    description: null,
    notes: null,
    categoryId: null,
    status: 'CONFIRMED',
    source: 'MANUAL',
    transferGroupId: 'grp-1',
    linkedTransactionId: null,
    transactionDate: new Date('2026-08-01T12:00:00.000Z'),
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    userId: 'user-1',
    ...overrides,
  };
}

describe('UpdateTransferUseCase', () => {
  const findTransactionById = jest.fn();
  const findTransactionsByTransferGroupId = jest.fn();
  const updateTransaction = jest.fn();
  const findAccountById = jest
    .fn()
    .mockImplementation((id: string) =>
      Promise.resolve({ id, currency: 'DOP' }),
    );

  const repo = {
    findTransactionById,
    findTransactionsByTransferGroupId,
    updateTransaction,
    findAccountById,
  } as unknown as LedgerRepositoryPort;

  const execute = jest.fn().mockResolvedValue({
    amount: 80,
    currency: 'DOP',
    ledgerAmount: 80,
    ledgerCurrency: 'DOP',
    amountBaseCurrency: 80,
    exchangeRate: 1,
  });
  const resolveAmounts = { execute } as unknown as ResolveAmountsUseCase;
  const processBatch = jest.fn();
  const outboxDispatcher = {
    processBatch,
  } as unknown as FinanceOutboxDispatcher;
  const baseCurrency = {
    execute: jest.fn().mockResolvedValue('DOP'),
  } as unknown as ResolveUserBaseCurrencyUseCase;

  const useCase = new UpdateTransferUseCase(
    repo,
    resolveAmounts,
    baseCurrency,
    outboxDispatcher,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findTransactionById.mockResolvedValue(leg());
    findTransactionsByTransferGroupId.mockResolvedValue([
      leg({ id: 'd1', type: 'DEBIT', accountId: 'a1' }),
      leg({ id: 'c1', type: 'CREDIT', accountId: 'a2' }),
    ]);
    updateTransaction.mockImplementation((_userId: string, id: string) =>
      Promise.resolve({ transaction: leg({ id }) }),
    );
  });

  it('updates both legs and refreshes the balances', async () => {
    await useCase.execute('user-1', 'd1', {
      fromAccountId: 'a1',
      toAccountId: 'a2',
      amount: 80,
      transactionDate: '2026-08-02T12:00:00.000Z',
    });

    expect(updateTransaction).toHaveBeenCalledTimes(2);
    expect(processBatch).toHaveBeenCalled();
  });

  it('rejects a leg that is not part of a transfer', async () => {
    findTransactionById.mockResolvedValue(leg({ transferGroupId: null }));

    await expect(
      useCase.execute('user-1', 'd1', {
        fromAccountId: 'a1',
        toAccountId: 'a2',
        amount: 80,
        transactionDate: '2026-08-02T12:00:00.000Z',
      }),
    ).rejects.toThrow(/not a transfer/i);
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it('rejects the same origin and destination', async () => {
    await expect(
      useCase.execute('user-1', 'd1', {
        fromAccountId: 'a1',
        toAccountId: 'a1',
        amount: 80,
        transactionDate: '2026-08-02T12:00:00.000Z',
      }),
    ).rejects.toThrow(/invalid transfer accounts/i);
    expect(updateTransaction).not.toHaveBeenCalled();
  });
});
