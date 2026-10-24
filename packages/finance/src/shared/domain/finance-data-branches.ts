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
  {
    id: 'finance.subscriptions',
    app: DATA_APP.FINANCE,
    label: 'Suscripciones',
    includes: [],
    order: 7,
  },
  {
    id: 'finance.recurring',
    app: DATA_APP.FINANCE,
    label: 'Recurrentes detectados',
    includes: [],
    order: 8,
  },
  {
    id: 'finance.merchants',
    app: DATA_APP.FINANCE,
    label: 'Comercios',
    includes: [],
    order: 9,
  },
  {
    id: 'finance.statements',
    app: DATA_APP.FINANCE,
    label: 'Estados de cuenta',
    includes: [],
    order: 11,
  },
  {
    id: 'finance.loans',
    app: DATA_APP.FINANCE,
    label: 'Préstamos',
    includes: [],
    order: 12,
  },
  {
    id: 'finance.savingsGoals',
    app: DATA_APP.FINANCE,
    label: 'Metas de ahorro',
    includes: [],
    order: 13,
  },
  {
    id: 'finance.receivables',
    app: DATA_APP.FINANCE,
    label: 'Cobros',
    includes: [],
    order: 14,
  },
  {
    id: 'finance.budgets',
    app: DATA_APP.FINANCE,
    label: 'Presupuestos',
    includes: [],
    order: 15,
  },
  {
    id: 'finance.categories',
    app: DATA_APP.FINANCE,
    label: 'Categorías propias',
    includes: ['finance.budgets'],
    order: 16,
  },
];
export const FINANCE_DATA_BRANCH_IDS = FINANCE_DATA_BRANCHES.map(
  (branch) => branch.id,
);
export function isFinanceDataBranch(id: string): boolean {
  return FINANCE_DATA_BRANCH_IDS.includes(id);
}
