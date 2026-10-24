import { DATA_APP, type DataBranchDescriptor } from '@personal-os/users';
import type { FinanceWipeLayer } from './finance-wipe-layers';

/**
 * Finance branches. During the transition the coarse layers are exposed as
 * branches with their current effects; the fine branches replace them without
 * touching the orchestrator.
 */
export const FINANCE_DATA_BRANCHES: readonly DataBranchDescriptor[] = [
  {
    id: 'finance.ledger',
    app: DATA_APP.FINANCE,
    label: 'Movimientos y saldos',
    includes: [],
    order: 1,
  },
  {
    id: 'finance.balances',
    app: DATA_APP.FINANCE,
    label: 'Saldos a cero',
    includes: [],
    order: 2,
  },
  {
    id: 'finance.planning',
    app: DATA_APP.FINANCE,
    label: 'Presupuestos, metas y préstamos',
    includes: [],
    order: 3,
  },
  {
    id: 'finance.categories',
    app: DATA_APP.FINANCE,
    label: 'Categorías propias',
    includes: ['finance.planning'],
    order: 4,
  },
  {
    id: 'finance.catalog',
    app: DATA_APP.FINANCE,
    label: 'Instituciones, cuentas y tarjetas',
    includes: ['finance.ledger'],
    order: 5,
  },
  {
    id: 'finance.emailConnections',
    app: DATA_APP.FINANCE,
    label: 'Conexiones de Gmail',
    includes: [],
    order: 6,
  },
];

export const FINANCE_DATA_BRANCH_IDS = FINANCE_DATA_BRANCHES.map(
  (branch) => branch.id,
);

export function isFinanceDataBranch(id: string): boolean {
  return FINANCE_DATA_BRANCH_IDS.includes(id);
}

/** A finance branch maps to the wipe layer with the same id today. */
export function layerForBranch(id: string): FinanceWipeLayer {
  return id as FinanceWipeLayer;
}
