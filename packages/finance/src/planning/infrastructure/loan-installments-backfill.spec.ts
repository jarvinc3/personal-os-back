import type { SyncLoanInstallmentsUseCase } from '../application/sync-loan-installments.use-case';
import { LoanInstallmentsBackfill } from './loan-installments-backfill';
import type { PlanningLoanRepository } from './planning-loan.repository';

const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

function setup(loans: readonly unknown[]) {
  const repo = {
    listLoansForScheduleSync: jest.fn().mockResolvedValue(loans),
  };
  const syncInstallments = { execute: jest.fn().mockResolvedValue(undefined) };
  const backfill = new LoanInstallmentsBackfill(
    repo as unknown as PlanningLoanRepository,
    syncInstallments as unknown as SyncLoanInstallmentsUseCase,
  );
  return { syncInstallments, backfill };
}

describe('LoanInstallmentsBackfill', () => {
  it('syncs every active loan', async () => {
    const { syncInstallments, backfill } = setup([
      { id: 'loan-1' },
      { id: 'loan-2' },
    ]);
    const now = utc(2026, 3, 1);

    await backfill.run(now);

    expect(syncInstallments.execute).toHaveBeenCalledTimes(2);
    expect(syncInstallments.execute).toHaveBeenNthCalledWith(
      1,
      { id: 'loan-1' },
      now,
    );
    expect(syncInstallments.execute).toHaveBeenNthCalledWith(
      2,
      { id: 'loan-2' },
      now,
    );
  });

  it('does nothing when there are no loans', async () => {
    const { syncInstallments, backfill } = setup([]);

    await backfill.run(utc(2026, 3, 1));

    expect(syncInstallments.execute).not.toHaveBeenCalled();
  });
});
