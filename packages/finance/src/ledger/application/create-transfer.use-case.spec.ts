import type { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import type { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import type { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { CreateTransferUseCase } from './create-transfer.use-case';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

describe('CreateTransferUseCase', () => {
  const createTransfer = jest.fn();
  const findAccountById = jest
    .fn()
    .mockImplementation((id: string) =>
      Promise.resolve({ id, currency: 'DOP' }),
    );

  const repo = {
    createTransfer,
    findAccountById,
  } as unknown as LedgerRepositoryPort;

  const execute = jest.fn().mockResolvedValue({
    amount: 50,
    currency: 'DOP',
    ledgerAmount: 50,
    ledgerCurrency: 'DOP',
    amountBaseCurrency: 50,
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

  const useCase = new CreateTransferUseCase(
    repo,
    resolveAmounts,
    baseCurrency,
    outboxDispatcher,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    createTransfer.mockResolvedValue({
      transferGroupId: 'grp-1',
      debit: {
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
        transactionDate: new Date(),
        createdAt: new Date(),
        userId: 'user-1',
      },
      credit: {
        id: 'c1',
        accountId: 'a2',
        cardId: null,
        type: 'CREDIT',
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
        transactionDate: new Date(),
        createdAt: new Date(),
        userId: 'user-1',
      },
    });
  });

  it('resolves FX for both legs and creates transfer', async () => {
    const createdTransfer = await useCase.execute('user-1', {
      fromAccountId: 'a1',
      toAccountId: 'a2',
      amount: 50,
      transactionDate: '2026-08-01',
    });
    expect(createdTransfer.transferGroupId).toBe('grp-1');
    expect(execute.mock.calls).toHaveLength(2);
    expect(createTransfer).toHaveBeenCalled();
    expect(processBatch).toHaveBeenCalled();
  });

  it('resolves a third amount for the fee', async () => {
    await useCase.execute('user-1', {
      fromAccountId: 'a1',
      toAccountId: 'a2',
      amount: 50,
      transactionDate: '2026-08-01',
      fee: { amount: 5 },
    });

    expect(execute.mock.calls).toHaveLength(3);
    const transferInput = createTransfer.mock.calls[0][0] as {
      feeAmounts?: unknown;
    };
    expect(transferInput.feeAmounts).toBeDefined();
  });
});
