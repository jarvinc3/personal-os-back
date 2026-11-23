import { ReverseTransferUseCase } from './reverse-transfer.use-case';
import type { LedgerReversalRepositoryPort } from './ports/ledger-reversal.repository.port';
import type { LedgerQueryRepositoryPort } from './ports/ledger-query.repository.port';

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

describe('ReverseTransferUseCase', () => {
  const findTransactionById = jest.fn();
  const findTransactionsByTransferGroupId = jest.fn();
  const reverseTransactionsByTransferGroupId = jest.fn();
  const wake = jest.fn();

  const repo = {
    findTransactionById,
    findTransactionsByTransferGroupId,
    reverseTransactionsByTransferGroupId,
  } as unknown as LedgerReversalRepositoryPort & LedgerQueryRepositoryPort;
  const useCase = new ReverseTransferUseCase(repo, repo, {
    wake,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    findTransactionById.mockResolvedValue(leg());
    findTransactionsByTransferGroupId.mockResolvedValue([
      leg({ id: 'd1', type: 'DEBIT', accountId: 'a1' }),
      leg({ id: 'c1', type: 'CREDIT', accountId: 'a2' }),
    ]);
  });

  it('reverses every confirmed leg of the operation', async () => {
    await useCase.execute('user-1', 'd1');

    expect(reverseTransactionsByTransferGroupId).toHaveBeenCalledWith(
      'user-1',
      'grp-1',
    );
    expect(wake).toHaveBeenCalled();
  });

  it('rejects a pending transfer', async () => {
    findTransactionsByTransferGroupId.mockResolvedValue([
      leg({ id: 'd1', status: 'PENDING' }),
      leg({ id: 'c1', status: 'PENDING' }),
    ]);

    await expect(useCase.execute('user-1', 'd1')).rejects.toMatchObject({
      response: { code: 'TRANSFER_NOT_COMPLETED' },
    });
    expect(reverseTransactionsByTransferGroupId).not.toHaveBeenCalled();
  });

  it('does nothing when it was already reversed', async () => {
    findTransactionsByTransferGroupId.mockResolvedValue([
      leg({ id: 'd1', status: 'REVERSED' }),
      leg({ id: 'c1', status: 'REVERSED' }),
    ]);

    await useCase.execute('user-1', 'd1');

    expect(reverseTransactionsByTransferGroupId).not.toHaveBeenCalled();
  });
});
