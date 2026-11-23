import type { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { monthBounds } from '../../reconciliation/domain/reconciliation-adjustment';
import { localDateIso } from '../../shared/domain/local-day';
import type { BalanceSheetRepository } from '../infrastructure/balance-sheet.repository';
import type { ReceivableRow } from './balance-sheet-types';

type BalanceSheetPositions = Awaited<
  ReturnType<BalanceSheetRepository['loadPositions']>
>;

export type BalanceSheetAccount = BalanceSheetPositions['accounts'][number];
export type BalanceSheetCardBalance =
  BalanceSheetPositions['cardBalances'][number];
export type BalanceSheetLoan = BalanceSheetPositions['loans'][number];
export type BalanceSheetDrift = Awaited<
  ReturnType<BalanceSheetRepository['loadOpenDrifts']>
>[number];
export type BalanceSheetReconciliation = Awaited<
  ReturnType<BalanceSheetRepository['loadMonthReconciliations']>
>[number];

export type BalanceSheetContext = {
  asOf: Date;
  rateDate: string;
  baseCurrency: string;
  timezone: string | null;
  month: string;
  positions: BalanceSheetPositions;
  receivables: ReceivableRow[];
  drifts: BalanceSheetDrift[];
  reconciliations: BalanceSheetReconciliation[];
};

export async function loadBalanceSheetContext(input: {
  userId: string;
  repo: BalanceSheetRepository;
  baseCurrency: ResolveUserBaseCurrencyUseCase;
}): Promise<BalanceSheetContext> {
  const asOf = new Date();
  const rateDate = asOf.toISOString().slice(0, 10);
  const baseCurrency = await input.baseCurrency.execute(input.userId);
  const timezone = await input.repo.loadUserTimezone(input.userId);
  const month = localDateIso(timezone, asOf).slice(0, 7);
  const { from, to } = monthBounds(month);
  const [positions, receivables, drifts, reconciliations] = await Promise.all([
    input.repo.loadPositions(input.userId),
    input.repo.loadReceivables(input.userId),
    input.repo.loadOpenDrifts(input.userId),
    input.repo.loadMonthReconciliations(input.userId, from, to),
  ]);

  return {
    asOf,
    rateDate,
    baseCurrency,
    timezone,
    month,
    positions,
    receivables,
    drifts,
    reconciliations,
  };
}
