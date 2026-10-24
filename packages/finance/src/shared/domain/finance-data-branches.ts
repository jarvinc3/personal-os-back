import { DATA_APP, type DataBranchDescriptor } from '@personal-os/users';

/**
 * Finance branches, in execution order. The identifiers are part of the HTTP
 * contract and the web shows their labels, so they are not renamed silently.
 */
export const FINANCE_DATA_BRANCHES: readonly DataBranchDescriptor[] = [
  {
    id: 'finance.reconciliations',
    app: DATA_APP.FINANCE,
    label: 'Conciliaciones y descuadres',
    includes: [],
    order: 1,
  },
  {
    id: 'finance.transactions',
    app: DATA_APP.FINANCE,
    label: 'Movimientos y transferencias',
    includes: ['finance.reconciliations'],
    order: 2,
  },
  {
    id: 'finance.balances',
    app: DATA_APP.FINANCE,
    label: 'Saldos a cero',
    includes: [],
    order: 3,
  },
  {
    id: 'finance.cards',
    app: DATA_APP.FINANCE,
    label: 'Tarjetas',
    includes: [],
    order: 4,
  },
  {
    id: 'finance.accounts',
    app: DATA_APP.FINANCE,
    label: 'Cuentas, incluido el efectivo',
    includes: [],
    order: 5,
  },
  {
    id: 'finance.institutions',
    app: DATA_APP.FINANCE,
    label: 'Instituciones',
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
