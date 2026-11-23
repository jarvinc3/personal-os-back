import type { CreateTransactionUseCase } from '../../ledger/application/create-transaction.use-case';
import { localDateIso } from '../../shared/domain/local-day';
import type { PlanningRepository } from '../infrastructure/planning.repository';
import { ApplyLoanPrepaymentUseCase } from './apply-loan-prepayment.use-case';
import type { SyncLoanInstallmentsUseCase } from './sync-loan-installments.use-case';

const SANTO_DOMINGO = 'America/Santo_Domingo';

function loan() {
  return {
    id: 'loan-1',
    currency: 'DOP',
    lenderName: 'Banco',
    originalAmount: 12000,
    currentBalance: 8000,
    installmentAmount: 1000,
    installmentFreq: 'MONTHLY',
    totalInstallments: 12,
    paidInstallments: 4,
    nextDueDate: new Date('2026-11-01T00:00:00.000Z'),
    interestRate: null,
    insuranceAmount: null,
    prepaymentPenaltyPct: null,
  };
}

function setup() {
  const repo = {
    findUserTimezone: jest.fn().mockResolvedValue(SANTO_DOMINGO),
    findLoan: jest.fn().mockResolvedValue(loan()),
    listInstallments: jest.fn().mockResolvedValue([]),
    findLoanPaymentCategoryId: jest.fn().mockResolvedValue(null),
    createLoanPrepayment: jest.fn().mockResolvedValue({ id: 'pre-1' }),
    updateLoan: jest.fn().mockResolvedValue(true),
  };
  const syncInstallments = { execute: jest.fn().mockResolvedValue(undefined) };
  const createTransaction = {
    execute: jest.fn().mockResolvedValue({ id: 'tx-1' }),
  };
  const useCase = new ApplyLoanPrepaymentUseCase(
    repo as unknown as PlanningRepository,
    syncInstallments as unknown as SyncLoanInstallmentsUseCase,
    createTransaction as unknown as CreateTransactionUseCase,
  );
  return { repo, useCase, createTransaction };
}

describe('ApplyLoanPrepaymentUseCase', () => {
  it('registers the prepayment and its expense on the local day picked', async () => {
    const { repo, useCase, createTransaction } = setup();

    await useCase.execute({
      userId: 'user-1',
      loanId: 'loan-1',
      now: new Date('2026-10-24T00:00:00.000Z'),
      command: {
        amount: 100,
        accountId: 'acc-1',
        mode: 'REDUCE_INSTALLMENT',
        date: '2026-10-23',
      },
    });

    expect(createTransaction.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        transactionDate: '2026-10-24T00:00:00.000Z',
        announce: false,
      }),
    );
    const prepayment = repo.createLoanPrepayment.mock.calls[0][0] as {
      paidAt: Date;
    };
    expect(prepayment.paidAt.toISOString()).toBe('2026-10-24T00:00:00.000Z');
    expect(localDateIso(SANTO_DOMINGO, prepayment.paidAt)).toBe('2026-10-23');
  });

  it('keeps the server time when no date is sent', async () => {
    const { repo, useCase } = setup();
    const now = new Date('2026-10-24T00:00:00.000Z');

    await useCase.execute({
      userId: 'user-1',
      loanId: 'loan-1',
      now: now,
      command: {
        amount: 100,
        accountId: 'acc-1',
        mode: 'REDUCE_INSTALLMENT',
      },
    });

    expect(repo.createLoanPrepayment.mock.calls[0][0].paidAt).toBe(now);
  });
});
