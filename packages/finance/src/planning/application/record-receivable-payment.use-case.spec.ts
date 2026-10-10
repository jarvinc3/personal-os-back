import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CreateTransactionUseCase } from '../../ledger/application/create-transaction.use-case';
import type { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import type { PlanningRepository } from '../infrastructure/planning.repository';
import { RecordReceivablePaymentUseCase } from './record-receivable-payment.use-case';

const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

function receivable(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    debtorName: 'Ana',
    amount: 80,
    paidAmount: 30,
    currency: 'DOP',
    ...overrides,
  };
}

function setup(options: { found?: unknown } = {}) {
  const found = 'found' in options ? options.found : receivable();
  const repo = {
    findReceivable: jest.fn().mockResolvedValue(found),
    createReceivablePayment: jest
      .fn()
      .mockResolvedValue({ id: 'pay-1', amount: 50 }),
  };
  const ownership = { assertAccountOwned: jest.fn().mockResolvedValue({}) };
  const createTransaction = {
    execute: jest.fn().mockResolvedValue({ id: 'tx-1' }),
  };

  const useCase = new RecordReceivablePaymentUseCase(
    repo as unknown as PlanningRepository,
    ownership as unknown as FinanceOwnershipService,
    createTransaction as unknown as CreateTransactionUseCase,
  );
  return { repo, ownership, createTransaction, useCase };
}

describe('RecordReceivablePaymentUseCase', () => {
  it('records the income on the given account and links it to the payment', async () => {
    const now = utc(2026, 10, 12);
    const { repo, createTransaction, useCase } = setup();

    const payment = await useCase.execute(
      'user-1',
      'rec-1',
      { amount: 50, accountId: 'acc-1' },
      now,
    );

    expect(createTransaction.execute).toHaveBeenCalledWith('user-1', {
      accountId: 'acc-1',
      type: 'CREDIT',
      amount: 50,
      currency: 'DOP',
      transactionDate: now.toISOString(),
      description: 'Cobro: Ana',
    });
    expect(repo.createReceivablePayment).toHaveBeenCalledWith('rec-1', {
      amount: 50,
      paidAt: now,
      accountId: 'acc-1',
      transactionId: 'tx-1',
    });
    expect(payment).toEqual({ id: 'pay-1', amount: '50' });
  });

  it('rejects a payment larger than what is still owed', async () => {
    const { repo, createTransaction, useCase } = setup();

    await expect(
      useCase.execute(
        'user-1',
        'rec-1',
        { amount: 60, accountId: 'acc-1' },
        utc(2026, 10, 12),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(createTransaction.execute).not.toHaveBeenCalled();
    expect(repo.createReceivablePayment).not.toHaveBeenCalled();
  });

  it('fails when the receivable is missing', async () => {
    const { repo, useCase } = setup({ found: null });

    await expect(
      useCase.execute(
        'user-1',
        'missing',
        { amount: 10, accountId: 'acc-1' },
        utc(2026, 10, 12),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(repo.createReceivablePayment).not.toHaveBeenCalled();
  });
});
