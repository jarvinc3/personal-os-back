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
    ...overrides,
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
      {
        installmentNo: 1,
        dueDate: utc(2026, 2, 5),
        amount: 1500,
        paidAt: null,
      },
      {
        installmentNo: 2,
        dueDate: utc(2026, 3, 5),
        amount: 1500,
        paidAt: null,
      },
      {
        installmentNo: 3,
        dueDate: utc(2026, 4, 5),
        amount: 1500,
        paidAt: null,
      },
    ]);
  });

  it('keeps the original payment date of a paid instalment', async () => {
    const paidAt = utc(2026, 1, 10);
    const { replaceLoanSchedule, useCase } = setup([
      { installmentNo: 1, paidAt },
    ]);

    await useCase.execute(
      loan({ paidInstallments: 1, nextDueDate: utc(2026, 3, 5) }),
      utc(2026, 2, 20),
    );

    expect(replaceLoanSchedule).toHaveBeenCalledWith('loan-1', [
      { installmentNo: 1, dueDate: utc(2026, 2, 5), amount: 1500, paidAt },
      {
        installmentNo: 2,
        dueDate: utc(2026, 3, 5),
        amount: 1500,
        paidAt: null,
      },
      {
        installmentNo: 3,
        dueDate: utc(2026, 4, 5),
        amount: 1500,
        paidAt: null,
      },
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
        nextDueDate: utc(2026, 4, 5),
      }),
      now,
    );

    expect(replaceLoanSchedule).toHaveBeenCalledWith('loan-1', [
      { installmentNo: 1, dueDate: utc(2026, 2, 5), amount: 1500, paidAt: now },
      { installmentNo: 2, dueDate: utc(2026, 3, 5), amount: 1500, paidAt: now },
      { installmentNo: 3, dueDate: utc(2026, 4, 5), amount: 1500, paidAt: now },
    ]);
  });
});
