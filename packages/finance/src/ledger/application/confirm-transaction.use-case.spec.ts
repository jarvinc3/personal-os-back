import type { DomainEventRelay } from '@personal-os/contracts';
import { ConfirmTransactionUseCase } from './confirm-transaction.use-case';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

describe('ConfirmTransactionUseCase', () => {
  const findTransactionById = jest.fn();
  const confirmTransaction = jest.fn();
  const confirmTransactionsByTransferGroupId = jest.fn();
  const wake = jest.fn();

  const repo = {
    findTransactionById,
    confirmTransaction,
    confirmTransactionsByTransferGroupId,
  } as unknown as LedgerRepositoryPort;

  const relay = {
    wake,
  } as unknown as DomainEventRelay;

  const useCase = new ConfirmTransactionUseCase(repo, relay);

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
    expect(wake).toHaveBeenCalled();
  });

  it('throws when missing', async () => {
    findTransactionById.mockResolvedValue(null);
    await expect(useCase.execute('user-1', 'missing')).rejects.toThrow(
      /no encontrad/i,
    );
  });
});
