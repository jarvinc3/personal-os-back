import type { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { UnconfirmTransferUseCase } from './unconfirm-transfer.use-case';
import type {
  LedgerRepositoryPort,
  LedgerTransactionRow,
} from './ports/ledger.repository.port';

function leg(
  overrides: Partial<LedgerTransactionRow> = {},
): LedgerTransactionRow {
  return {
    id: 'd1',
    userId: 'user-1',
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
    ...overrides,
  };
}

describe('UnconfirmTransferUseCase', () => {
  const findTransactionById = jest.fn();
  const unconfirmTransactionsByTransferGroupId = jest.fn();
  const repo = {
    findTransactionById,
    unconfirmTransactionsByTransferGroupId,
  } as unknown as LedgerRepositoryPort;

  const processBatch = jest.fn();
  const outboxDispatcher = {
    processBatch,
  } as unknown as FinanceOutboxDispatcher;

  const useCase = new UnconfirmTransferUseCase(repo, outboxDispatcher);

  beforeEach(() => {
    jest.clearAllMocks();
    findTransactionById.mockResolvedValue(leg());
    unconfirmTransactionsByTransferGroupId.mockResolvedValue({ count: 2 });
  });

  it('moves every leg of the operation back to pending', async () => {
    await useCase.execute('user-1', 'd1');

    expect(unconfirmTransactionsByTransferGroupId).toHaveBeenCalledWith(
      'user-1',
      'grp-1',
    );
    expect(processBatch).toHaveBeenCalled();
  });

  it('refuses a movement that is not part of a transfer', async () => {
    findTransactionById.mockResolvedValue(leg({ transferGroupId: null }));

    await expect(useCase.execute('user-1', 'd1')).rejects.toThrow(
      /no es una transferencia/i,
    );
    expect(unconfirmTransactionsByTransferGroupId).not.toHaveBeenCalled();
  });
});
