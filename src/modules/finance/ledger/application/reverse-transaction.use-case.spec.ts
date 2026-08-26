import { NotFoundException } from '@nestjs/common';
import type { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { ReverseTransactionUseCase } from './reverse-transaction.use-case';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

function ledgerRow(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-08-01T12:00:00.000Z');
  return {
    id: 'tx-1',
    userId: 'user-1',
    accountId: 'acc-1',
    account: { id: 'acc-1', name: 'Main' },
    cardId: null,
    card: null,
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
    status: 'REVERSED',
    source: 'MANUAL',
    transferGroupId: null,
    linkedTransactionId: null,
    aiMetadata: null,
    transactionDate: now,
    createdAt: now,
    ...overrides,
  };
}

describe('ReverseTransactionUseCase', () => {
  const reverseTransaction = jest.fn();
  const processBatch = jest.fn();
  const repo = { reverseTransaction } as unknown as LedgerRepositoryPort;
  const outboxDispatcher = {
    processBatch,
  } as unknown as FinanceOutboxDispatcher;
  const useCase = new ReverseTransactionUseCase(repo, outboxDispatcher);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps the reversed row and wakes the outbox', async () => {
    reverseTransaction.mockResolvedValue({
      transaction: ledgerRow(),
      budgetSnapshots: [],
    });

    const result = await useCase.execute('user-1', 'tx-1');

    expect(reverseTransaction).toHaveBeenCalledWith('user-1', 'tx-1', undefined);
    expect(result).toMatchObject({
      id: 'tx-1',
      status: 'REVERSED',
      amount: '10',
    });
    expect(processBatch).toHaveBeenCalled();
  });

  it('is a no-op map when the repository returns an already reversed row', async () => {
    reverseTransaction.mockResolvedValue({
      transaction: ledgerRow({ status: 'REVERSED' }),
      budgetSnapshots: [],
    });

    const result = await useCase.execute('user-1', 'tx-1');
    expect(result.status).toBe('REVERSED');
    expect(processBatch).toHaveBeenCalled();
  });

  it('throws when missing', async () => {
    reverseTransaction.mockResolvedValue(null);
    await expect(useCase.execute('user-1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
