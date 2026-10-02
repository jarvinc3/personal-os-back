import type { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { ConfirmTransactionUseCase } from './confirm-transaction.use-case';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

describe('ConfirmTransactionUseCase', () => {
  const findTransactionById = jest.fn();
  const confirmTransaction = jest.fn();
  const confirmTransactionsByTransferGroupId = jest.fn();
  const processBatch = jest.fn();

  const repo = {
    findTransactionById,
    confirmTransaction,
    confirmTransactionsByTransferGroupId,
  } as unknown as LedgerRepositoryPort;

  const outboxDispatcher = {
    processBatch,
  } as unknown as FinanceOutboxDispatcher;

  const useCase = new ConfirmTransactionUseCase(repo, outboxDispatcher);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('confirms a single PENDING transaction', async () => {
    findTransactionById.mockResolvedValue({
      id: 'tx-1',
      transferGroupId: null,
    });
    confirmTransaction.mockResolvedValue({
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
        source: 'MANUAL',
        transferGroupId: null,
        linkedTransactionId: null,
        transactionDate: new Date(),
        createdAt: new Date(),
        userId: 'user-1',
      },
      budgetSnapshots: [],
    });

    const result = await useCase.execute('user-1', 'tx-1');
    expect(result.status).toBe('CONFIRMED');
    expect(confirmTransaction).toHaveBeenCalledWith('user-1', 'tx-1');
    expect(processBatch).toHaveBeenCalled();
  });

  it('throws when missing', async () => {
    findTransactionById.mockResolvedValue(null);
    await expect(useCase.execute('user-1', 'missing')).rejects.toThrow(
      /not found/i,
    );
  });
});
