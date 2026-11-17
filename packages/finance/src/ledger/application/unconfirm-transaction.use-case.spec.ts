import type { DomainEventRelay } from '@personal-os/contracts';
import { UnconfirmTransactionUseCase } from './unconfirm-transaction.use-case';
import type {
  LedgerRepositoryPort,
  LedgerTransactionRow,
} from './ports/ledger.repository.port';

function tx(
  overrides: Partial<LedgerTransactionRow> = {},
): LedgerTransactionRow {
  return {
    id: 'tx-1',
    userId: 'user-1',
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
    categoryId: 'cat-expense',
    status: 'CONFIRMED',
    source: 'MANUAL',
    transferGroupId: null,
    linkedTransactionId: null,
    transactionDate: new Date('2026-08-01'),
    createdAt: new Date('2026-08-01'),
    ...overrides,
  };
}

describe('UnconfirmTransactionUseCase', () => {
  const findTransactionById = jest.fn();
  const findPlanningLinkKind = jest.fn();
  const unconfirmTransaction = jest.fn();
  const repo = {
    findTransactionById,
    findPlanningLinkKind,
    unconfirmTransaction,
  } as unknown as LedgerRepositoryPort;

  const relay = {
    wake: jest.fn(),
  } as unknown as DomainEventRelay;

  const useCase = new UnconfirmTransactionUseCase(repo, relay);

  beforeEach(() => {
    jest.clearAllMocks();
    findTransactionById.mockResolvedValue(tx());
    findPlanningLinkKind.mockResolvedValue(null);
    unconfirmTransaction.mockResolvedValue({
      transaction: tx({ status: 'PENDING' }),
      budgetSnapshots: [],
    });
  });

  it('reverts a CONFIRMED movement to PENDING', async () => {
    const unconfirmed = await useCase.execute('user-1', 'tx-1');

    expect(unconfirmTransaction).toHaveBeenCalledWith('user-1', 'tx-1');
    expect(unconfirmed.status).toBe('PENDING');
  });

  it('refuses a transfer leg', async () => {
    findTransactionById.mockResolvedValue(tx({ transferGroupId: 'grp-1' }));

    await expect(useCase.execute('user-1', 'tx-1')).rejects.toMatchObject({
      response: { code: 'TRANSACTION_LINKED' },
    });
    expect(unconfirmTransaction).not.toHaveBeenCalled();
  });

  it('refuses an immutable status', async () => {
    findTransactionById.mockResolvedValue(tx({ status: 'REVERSED' }));

    await expect(useCase.execute('user-1', 'tx-1')).rejects.toMatchObject({
      response: { code: 'TRANSACTION_IMMUTABLE' },
    });
    expect(unconfirmTransaction).not.toHaveBeenCalled();
  });

  it('refuses a movement linked to a planning record', async () => {
    findPlanningLinkKind.mockResolvedValue('LOAN_INSTALLMENT');

    await expect(useCase.execute('user-1', 'tx-1')).rejects.toMatchObject({
      response: { code: 'TRANSACTION_LINKED' },
    });
    expect(unconfirmTransaction).not.toHaveBeenCalled();
  });
});
