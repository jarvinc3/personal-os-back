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

function installment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inst-2',
    installmentNo: 2,
    amount: 1500,
    principal: 1500,
    interest: 0,
    insurance: 0,
    fees: 0,
    lateFee: 0,
    paidAmount: 0,
    ...overrides,
  };
}

function setup(options: { found?: unknown; nextInstallment?: unknown } = {}) {
  const found = 'found' in options ? options.found : loan();
  const nextInstallment =
    'nextInstallment' in options ? options.nextInstallment : installment();

  const repo = {
    findLoan: jest.fn().mockResolvedValue(found),
    findNextUnpaidInstallment: jest.fn().mockResolvedValue(nextInstallment),
    findLoanPaymentCategoryId: jest.fn().mockResolvedValue(null),
    applyInstallmentPayment: jest.fn().mockResolvedValue(undefined),
    updateLoan: jest.fn().mockResolvedValue(undefined),
    createLoanPrepayment: jest.fn().mockResolvedValue(undefined),
  };
  const syncInstallments = { execute: jest.fn().mockResolvedValue(undefined) };
  const createTransaction = {
    execute: jest.fn().mockResolvedValue({ id: 'tx-1' }),
  };

  const useCase = new PayNextLoanInstallmentUseCase(
    repo as unknown as PlanningRepository,
    syncInstallments as unknown as SyncLoanInstallmentsUseCase,
    createTransaction as unknown as CreateTransactionUseCase,
  );
  return { repo, syncInstallments, createTransaction, useCase, found };
}

describe('PayNextLoanInstallmentUseCase', () => {
  it('records the movement and lowers the balance only by the principal', async () => {
    const now = utc(2026, 2, 10);
    const { repo, syncInstallments, createTransaction, useCase, found } =
      setup();

    await useCase.execute({ userId: 'user-1', loanId: 'loan-1', now: now });

    expect(syncInstallments.execute).toHaveBeenCalledWith(found, now);
    expect(createTransaction.execute).toHaveBeenCalledWith('user-1', {
      accountId: 'acc-1',
      type: 'DEBIT',
      amount: 1500,
      currency: 'DOP',
      transactionDate: now.toISOString(),
      description: 'Cuota 2: BHD',
    });
    expect(repo.applyInstallmentPayment).toHaveBeenCalledWith('inst-2', {
      paidAmount: 1500,
      status: 'PAID',
      paidAt: now,
      transactionId: 'tx-1',
    });
    expect(repo.updateLoan).toHaveBeenCalledWith('user-1', 'loan-1', {
      paidInstallments: 2,
      currentBalance: 3500,
      nextDueDate: utc(2026, 3, 5),
    });
  });

  it('splits a short payment and leaves the instalment partial', async () => {
    const now = utc(2026, 2, 10);
    const { repo, useCase } = setup({
      nextInstallment: installment({ principal: 900, interest: 600 }),
    });

    const paymentResult = await useCase.execute({
      userId: 'user-1',
      loanId: 'loan-1',
      now: now,
      command: {
        amount: 1000,
      },
    });

    expect(repo.applyInstallmentPayment).toHaveBeenCalledWith('inst-2', {
      paidAmount: 1000,
      status: 'PARTIAL',
      paidAt: null,
      transactionId: 'tx-1',
    });
    expect(repo.updateLoan).toHaveBeenCalledWith('user-1', 'loan-1', {
      currentBalance: 4600,
    });
    expect(paymentResult.breakdown).toMatchObject({
      interest: 600,
      principal: 400,
    });
  });

  it('refuses an excess unless it is confirmed as prepayment', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({
        userId: 'user-1',
        loanId: 'loan-1',
        now: utc(2026, 2, 10),
        command: { amount: 2000 },
      }),
    ).rejects.toMatchObject({
      response: { code: 'PAYMENT_EXCEEDS_INSTALLMENT' },
    });
  });

  it('refuses to pay when no account is linked', async () => {
    const now = utc(2026, 2, 10);
    const { repo, createTransaction, useCase } = setup({
      found: loan({ accountId: null }),
    });

    await expect(
      useCase.execute({ userId: 'user-1', loanId: 'loan-1', now: now }),
    ).rejects.toMatchObject({
      response: { code: 'LOAN_ACCOUNT_REQUIRED' },
    });
    expect(createTransaction.execute).not.toHaveBeenCalled();
    expect(repo.applyInstallmentPayment).not.toHaveBeenCalled();
  });

  it('fails when there is no pending instalment', async () => {
    const { repo, createTransaction, useCase } = setup({
      nextInstallment: null,
    });

    await expect(
      useCase.execute({
        userId: 'user-1',
        loanId: 'loan-1',
        now: utc(2026, 2, 10),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createTransaction.execute).not.toHaveBeenCalled();
    expect(repo.applyInstallmentPayment).not.toHaveBeenCalled();
  });

  it('fails when the loan is missing', async () => {
    const { useCase } = setup({ found: null });

    await expect(
      useCase.execute({
        userId: 'user-1',
        loanId: 'missing',
        now: utc(2026, 2, 10),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
