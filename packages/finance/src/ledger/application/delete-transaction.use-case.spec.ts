import type { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { DeleteTransactionUseCase } from './delete-transaction.use-case';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

describe('DeleteTransactionUseCase', () => {
  const findTransactionById = jest.fn();
  const deleteTransaction = jest.fn();
  const deleteTransactionsByTransferGroupId = jest.fn();
  const processBatch = jest.fn();

  const repo = {
    findTransactionById,
    deleteTransaction,
    deleteTransactionsByTransferGroupId,
  } as unknown as LedgerRepositoryPort;

  const outboxDispatcher = {
    processBatch,
  } as unknown as FinanceOutboxDispatcher;

  const useCase = new DeleteTransactionUseCase(repo, outboxDispatcher);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes a single MANUAL transaction and wakes the outbox dispatcher', async () => {
    findTransactionById.mockResolvedValue({
      id: 'tx-1',
      transferGroupId: null,
    });
    deleteTransaction.mockResolvedValue({ count: 1 });

    await expect(useCase.execute('user-1', 'tx-1')).resolves.toEqual({
      success: true,
      undoId: 'tx-1',
    });
    expect(deleteTransaction).toHaveBeenCalledWith('user-1', 'tx-1');
    expect(deleteTransactionsByTransferGroupId).not.toHaveBeenCalled();
    expect(processBatch).toHaveBeenCalled();
  });

  it('deletes a transfer group and wakes the outbox dispatcher', async () => {
    findTransactionById.mockResolvedValue({
      id: 'debit-1',
      transferGroupId: 'grp-1',
    });
    deleteTransactionsByTransferGroupId.mockResolvedValue({ count: 2 });

    await expect(useCase.execute('user-1', 'debit-1')).resolves.toEqual({
      success: true,
      undoId: 'grp-1',
    });
    expect(deleteTransactionsByTransferGroupId).toHaveBeenCalledWith(
      'user-1',
      'grp-1',
    );
    expect(deleteTransaction).not.toHaveBeenCalled();
    expect(processBatch).toHaveBeenCalled();
  });

  it('throws without waking the dispatcher when the row is missing', async () => {
    findTransactionById.mockResolvedValue(null);

    await expect(useCase.execute('user-1', 'missing')).rejects.toThrow(
      /not found/i,
    );
    expect(deleteTransaction).not.toHaveBeenCalled();
    expect(processBatch).not.toHaveBeenCalled();
  });
});
