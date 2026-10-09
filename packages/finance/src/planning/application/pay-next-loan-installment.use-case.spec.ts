import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CreateTransactionUseCase } from '../../ledger/application/create-transaction.use-case';
import type { PlanningRepository } from '../infrastructure/planning.repository';
import { PayNextLoanInstallmentUseCase } from './pay-next-loan-installment.use-case';
import type { SyncLoanInstallmentsUseCase } from './sync-loan-installments.use-case';

const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

function loan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'loan-1',
    lenderName: 'BHD',
    accountId: 'acc-1',
    currency: 'DOP',
    currentBalance: 5000,
    installmentAmount: 1500,
    installmentFreq: 'MONTHLY' as const,
    nextDueDate: utc(2026, 2, 5),
    paidInstallments: 1,
    ...overrides,
  };
}

function setup(options: { found?: unknown; nextInstallment?: unknown } = {}) {
  const found = 'found' in options ? options.found : loan();
  const nextInstallment =
    'nextInstallment' in options
      ? options.nextInstallment
      : { id: 'inst-2', installmentNo: 2, amount: 1500 };

  const repo = {
    findLoan: jest.fn().mockResolvedValue(found),
    findNextUnpaidInstallment: jest.fn().mockResolvedValue(nextInstallment),
    markInstallmentPaid: jest.fn().mockResolvedValue(undefined),
    updateLoan: jest.fn().mockResolvedValue(undefined),
  };
  const syncInstallments = { execute: jest.fn().mockResolvedValue(undefined) };
  const createTransaction = { execute: jest.fn().mockResolvedValue(undefined) };

  const useCase = new PayNextLoanInstallmentUseCase(
    repo as unknown as PlanningRepository,
    syncInstallments as unknown as SyncLoanInstallmentsUseCase,
    createTransaction as unknown as CreateTransactionUseCase,
  );
  return { repo, syncInstallments, createTransaction, useCase, found };
}

describe('PayNextLoanInstallmentUseCase', () => {
  it('records the movement on the linked account and advances the loan', async () => {
    const now = utc(2026, 2, 10);
    const { repo, syncInstallments, createTransaction, useCase, found } =
      setup();

    await useCase.execute('user-1', 'loan-1', now);

    expect(syncInstallments.execute).toHaveBeenCalledWith(found, now);
    expect(createTransaction.execute).toHaveBeenCalledWith('user-1', {
      accountId: 'acc-1',
      type: 'DEBIT',
      amount: 1500,
      currency: 'DOP',
      transactionDate: now.toISOString(),
      description: 'Cuota 2: BHD',
    });
    expect(repo.markInstallmentPaid).toHaveBeenCalledWith('inst-2', now);
    expect(repo.updateLoan).toHaveBeenCalledWith('user-1', 'loan-1', {
      paidInstallments: 2,
      currentBalance: 3500,
      nextDueDate: utc(2026, 3, 5),
    });
  });

  it('skips the movement when the loan has no linked account', async () => {
    const now = utc(2026, 2, 10);
    const { repo, createTransaction, useCase } = setup({
      found: loan({ accountId: null }),
    });

    await useCase.execute('user-1', 'loan-1', now);

    expect(createTransaction.execute).not.toHaveBeenCalled();
    expect(repo.markInstallmentPaid).toHaveBeenCalledWith('inst-2', now);
    expect(repo.updateLoan).toHaveBeenCalled();
  });

  it('fails when there is no pending instalment', async () => {
    const { repo, createTransaction, useCase } = setup({
      nextInstallment: null,
    });

    await expect(
      useCase.execute('user-1', 'loan-1', utc(2026, 2, 10)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createTransaction.execute).not.toHaveBeenCalled();
    expect(repo.markInstallmentPaid).not.toHaveBeenCalled();
  });

  it('fails when the loan is missing', async () => {
    const { useCase } = setup({ found: null });

    await expect(
      useCase.execute('user-1', 'missing', utc(2026, 2, 10)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
