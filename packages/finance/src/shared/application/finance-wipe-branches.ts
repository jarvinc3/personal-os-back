import type { FinanceWipeBranches } from './finance-wipe-branch';
import { catalogWipeBranches } from './finance-wipe-catalog-branches';
import { ledgerWipeBranches } from './finance-wipe-ledger-branches';
import { planningWipeBranches } from './finance-wipe-planning-branches';

/** Every data branch of Finance, grouped by area and keyed by branch id. */
export function financeWipeBranches(): FinanceWipeBranches {
  return {
    ...ledgerWipeBranches(),
    ...catalogWipeBranches(),
    ...planningWipeBranches(),
  };
}
