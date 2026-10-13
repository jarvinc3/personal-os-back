import type { PlanningRepository } from '../infrastructure/planning.repository';
import {
  SyncLoanInstallmentsUseCase,
  type LoanScheduleSource,
} from './sync-loan-installments.use-case';

const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

function loan(overrides: Partial<LoanScheduleSource> = {}): LoanScheduleSource {
  return {
    id: 'loan-1',
    nextDueDate: utc(2026, 2, 5),
    paidInstallments: 0,
    installmentFreq: 'MONTHLY',
    totalInstallments: 3,
    installmentAmount: 1500,
    originalAmount: 4500,
    currentBalance: 4500,
    interestRate: null,
    insuranceAmount: null,
    ...overrides,
  };
}

function planRow(installmentNo: number, dueDate: Date, paidAt: Date | null) {
  const paid = paidAt !== null;
  return {
    installmentNo,
    dueDate,
    principal: 1500,
    interest: 0,
    insurance: 0,
    amount: 1500,
    paidAt,
    status: paid ? 'PAID' : 'PENDING',
    paidAmount: paid ? 1500 : 0,
    fees: 0,
    lateFee: 0,
  };
}

function setup(stored: readonly unknown[] = []) {
  const replaceLoanSchedule = jest.fn().mockResolvedValue(undefined);
  const repo = {
    listInstallments: jest.fn().mockResolvedValue(stored),
    replaceLoanSchedule,
  } as unknown as PlanningRepository;
  const useCase = new SyncLoanInstallmentsUseCase(repo);
  return { replaceLoanSchedule, useCase };
}

describe('SyncLoanInstallmentsUseCase', () => {
  it('writes the whole schedule unpaid for a new loan', async () => {
    const { replaceLoanSchedule, useCase } = setup();

    await useCase.execute(loan(), utc(2026, 1, 20));

    expect(replaceLoanSchedule).toHaveBeenCalledWith('loan-1', [
      planRow(1, utc(2026, 2, 5), null),
      planRow(2, utc(2026, 3, 5), null),
      planRow(3, utc(2026, 4, 5), null),
    ]);
  });

  it('keeps the original payment date of a paid instalment', async () => {
    const paidAt = utc(2026, 1, 10);
    const { replaceLoanSchedule, useCase } = setup([
      { installmentNo: 1, paidAt },
    ]);

    await useCase.execute(
      loan({
        paidInstallments: 1,
        currentBalance: 3000,
        nextDueDate: utc(2026, 3, 5),
      }),
      utc(2026, 2, 20),
    );

    expect(replaceLoanSchedule).toHaveBeenCalledWith('loan-1', [
      planRow(1, utc(2026, 2, 5), paidAt),
      planRow(2, utc(2026, 3, 5), null),
      planRow(3, utc(2026, 4, 5), null),
    ]);
  });

  it('stamps a payment date when the stored instalment has none', async () => {
    const now = utc(2026, 2, 20);
    const { replaceLoanSchedule, useCase } = setup();

    await useCase.execute(
      loan({ paidInstallments: 1, nextDueDate: utc(2026, 3, 5) }),
      now,
    );

    expect(replaceLoanSchedule).toHaveBeenCalledWith(
      'loan-1',
      expect.arrayContaining([
        expect.objectContaining({ installmentNo: 1, paidAt: now }),
      ]),
    );
  });

  it('clears the payment date when an instalment becomes unpaid again', async () => {
    const { replaceLoanSchedule, useCase } = setup([
      { installmentNo: 1, paidAt: utc(2026, 1, 10) },
    ]);

    await useCase.execute(loan(), utc(2026, 2, 20));

    expect(replaceLoanSchedule).toHaveBeenCalledWith(
      'loan-1',
      expect.arrayContaining([
        expect.objectContaining({ installmentNo: 1, paidAt: null }),
      ]),
    );
  });

  it('regenerates a fully paid loan without failing', async () => {
    const now = utc(2026, 5, 20);
    const { replaceLoanSchedule, useCase } = setup();

    await useCase.execute(
      loan({
        paidInstallments: 3,
        totalInstallments: 3,
        currentBalance: 0,
        nextDueDate: utc(2026, 4, 5),
      }),
      now,
    );

    expect(replaceLoanSchedule).toHaveBeenCalledWith('loan-1', [
      planRow(1, utc(2026, 2, 5), now),
      planRow(2, utc(2026, 3, 5), now),
      planRow(3, utc(2026, 4, 5), now),
    ]);
  });
});
