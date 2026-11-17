import type { DomainEventRelay } from '@personal-os/contracts';
import { DeleteTransactionUseCase } from './delete-transaction.use-case';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

describe('DeleteTransactionUseCase', () => {
  const findTransactionById = jest.fn();
  const deleteTransaction = jest.fn();
  const deleteTransactionsByTransferGroupId = jest.fn();
  const wake = jest.fn();

  const repo = {
    findTransactionById,
    deleteTransaction,
    deleteTransactionsByTransferGroupId,
  } as unknown as LedgerRepositoryPort;

  const relay = {
    wake,
  } as unknown as DomainEventRelay;

  const useCase = new DeleteTransactionUseCase(repo, relay);

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
    expect(wake).toHaveBeenCalled();
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
    expect(wake).toHaveBeenCalled();
  });

  it('throws without waking the dispatcher when the row is missing', async () => {
    findTransactionById.mockResolvedValue(null);

    await expect(useCase.execute('user-1', 'missing')).rejects.toThrow(
      /no encontrad/i,
    );
    expect(deleteTransaction).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
  });
});
