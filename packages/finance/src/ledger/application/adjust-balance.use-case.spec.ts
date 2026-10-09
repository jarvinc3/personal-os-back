import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import type { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import type { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';
import { AdjustBalanceUseCase } from './adjust-balance.use-case';

function build() {
  const findBalanceAdjustmentTarget = jest.fn();
  const createBalanceAdjustment = jest.fn();
  const repo = {
    findBalanceAdjustmentTarget,
    createBalanceAdjustment,
  } as unknown as LedgerRepositoryPort;
  const resolveAmounts = {
    execute: jest.fn().mockResolvedValue({
      amount: 50,
      currency: 'DOP',
      ledgerAmount: 50,
      ledgerCurrency: 'DOP',
      amountBaseCurrency: 50,
      exchangeRate: 1,
    }),
  } as unknown as ResolveAmountsUseCase;
  const baseCurrency = {
    execute: jest.fn().mockResolvedValue('DOP'),
  } as unknown as ResolveUserBaseCurrencyUseCase;
  const outboxDispatcher = {
    processBatch: jest.fn(),
  } as unknown as FinanceOutboxDispatcher;
  const useCase = new AdjustBalanceUseCase(
    repo,
    resolveAmounts,
    baseCurrency,
    outboxDispatcher,
  );
  return {
    useCase,
    findBalanceAdjustmentTarget,
    createBalanceAdjustment,
    resolveAmounts,
  };
}

describe('AdjustBalanceUseCase', () => {
  it('posts a positive adjustment when the target is higher', async () => {
    const harness = build();
    harness.findBalanceAdjustmentTarget.mockResolvedValue({
      accountId: 'acc-1',
      cardId: null,
      currency: 'DOP',
      currentBalance: 100,
    });
    harness.createBalanceAdjustment.mockResolvedValue({
      transaction: {
        id: 'tx-1',
        userId: 'user-1',
        accountId: 'acc-1',
        cardId: null,
        type: 'ADJUSTMENT',
        amount: 50,
        ledgerAmount: 50,
        amountBaseCurrency: 50,
        currency: 'DOP',
        ledgerCurrency: 'DOP',
        exchangeRate: 1,
        merchant: null,
        description: 'Reajuste de saldo',
        notes: null,
        categoryId: null,
        status: 'CONFIRMED',
        source: 'MANUAL',
        transferGroupId: null,
        linkedTransactionId: null,
        transactionDate: new Date(),
        createdAt: new Date(),
      },
      budgetSnapshots: [],
    });

    const result = await harness.useCase.execute('user-1', {
      accountId: 'acc-1',
      balance: 150,
    });

    expect(harness.createBalanceAdjustment).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        accountId: 'acc-1',
        cardId: null,
        amounts: expect.objectContaining({
          amount: 50,
          ledgerAmount: 50,
        }),
      }),
    );
    expect(result.adjusted).toBe(true);
    expect(result.balance).toBe(150);
  });

  it('stores a negative ledger amount when the target is lower', async () => {
    const harness = build();
    harness.findBalanceAdjustmentTarget.mockResolvedValue({
      accountId: null,
      cardId: 'card-1',
      currency: 'USD',
      currentBalance: 80,
    });
    harness.createBalanceAdjustment.mockResolvedValue({
      transaction: {
        id: 'tx-2',
        userId: 'user-1',
        accountId: null,
        cardId: 'card-1',
        type: 'ADJUSTMENT',
        amount: 30,
        ledgerAmount: -30,
        amountBaseCurrency: 30,
        currency: 'USD',
        ledgerCurrency: 'USD',
        exchangeRate: 1,
        merchant: null,
        description: 'Reajuste de saldo',
        notes: null,
        categoryId: null,
        status: 'CONFIRMED',
        source: 'MANUAL',
        transferGroupId: null,
        linkedTransactionId: null,
        transactionDate: new Date(),
        createdAt: new Date(),
      },
      budgetSnapshots: [],
    });

    await harness.useCase.execute('user-1', {
      cardId: 'card-1',
      currency: 'USD',
      balance: 50,
    });

    expect(harness.resolveAmounts.execute).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 30, currency: 'USD' }),
    );
    expect(harness.createBalanceAdjustment).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        amounts: expect.objectContaining({ ledgerAmount: -30 }),
      }),
    );
  });

  it('does not create a movement when the balance already matches', async () => {
    const harness = build();
    harness.findBalanceAdjustmentTarget.mockResolvedValue({
      accountId: 'acc-1',
      cardId: null,
      currency: 'DOP',
      currentBalance: 40,
    });

    const result = await harness.useCase.execute('user-1', {
      accountId: 'acc-1',
      balance: 40,
    });

    expect(harness.createBalanceAdjustment).not.toHaveBeenCalled();
    expect(result).toEqual({
      adjusted: false,
      balance: 40,
      transaction: null,
    });
  });

  it('rejects a missing target and a request with both instruments', async () => {
    const harness = build();
    harness.findBalanceAdjustmentTarget.mockResolvedValue(null);

    await expect(
      harness.useCase.execute('user-1', { accountId: 'missing', balance: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      harness.useCase.execute('user-1', {
        accountId: 'acc-1',
        cardId: 'card-1',
        balance: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
