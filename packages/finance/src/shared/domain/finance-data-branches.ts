import { DATA_APP, type DataBranchDescriptor } from '@personal-os/users';
/**
 * Finance branches, in execution order. The identifiers are part of the HTTP
 * contract and the web shows their labels, so they are not renamed silently.
 *
 * `includes` names the branches whose rows the schema deletes in cascade, so the
 * confirmation lists them with their count. Each dragged branch runs before the
 * one that drags it: the cascade would otherwise empty it first and the wipe
 * would report fewer rows than the user confirmed. References the schema leaves
 * at NULL are not includes.
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
    id: 'finance.statements',
    app: DATA_APP.FINANCE,
    label: 'Estados de cuenta',
    includes: [],
    order: 4,
  },
  {
    id: 'finance.loans',
    app: DATA_APP.FINANCE,
    label: 'Préstamos',
    includes: [],
    order: 5,
  },
  {
    id: 'finance.cards',
    app: DATA_APP.FINANCE,
    label: 'Tarjetas',
    includes: [
      'finance.reconciliations',
      'finance.transactions',
      'finance.statements',
    ],
    order: 6,
  },
  {
    id: 'finance.accounts',
    app: DATA_APP.FINANCE,
    label: 'Cuentas, incluido el efectivo',
    // Debit cards hang from the account, but declaring `finance.cards` here
    // would wipe every credit card too.
    includes: [
      'finance.reconciliations',
      'finance.transactions',
      'finance.loans',
    ],
    order: 7,
  },
  {
    id: 'finance.institutions',
    app: DATA_APP.FINANCE,
    label: 'Instituciones',
    includes: ['finance.accounts', 'finance.cards', 'finance.loans'],
    order: 8,
  },
  {
    id: 'finance.subscriptions',
    app: DATA_APP.FINANCE,
    label: 'Suscripciones',
    includes: [],
    order: 9,
  },
  {
    id: 'finance.recurring',
    app: DATA_APP.FINANCE,
    label: 'Recurrentes detectados',
    includes: [],
    order: 10,
  },
  {
    id: 'finance.merchants',
    app: DATA_APP.FINANCE,
    label: 'Comercios',
    includes: [],
    order: 11,
  },
  {
    id: 'finance.savingsGoals',
    app: DATA_APP.FINANCE,
    label: 'Metas de ahorro',
    includes: [],
    order: 12,
  },
  {
    id: 'finance.receivables',
    app: DATA_APP.FINANCE,
    label: 'Cobros',
    includes: [],
    order: 13,
  },
  {
    id: 'finance.budgets',
    app: DATA_APP.FINANCE,
    label: 'Presupuestos',
    includes: [],
    order: 14,
  },
  {
    id: 'finance.categories',
    app: DATA_APP.FINANCE,
    label: 'Categorías propias',
    includes: ['finance.budgets'],
    order: 15,
  },
];
export const FINANCE_DATA_BRANCH_IDS = FINANCE_DATA_BRANCHES.map(
  (branch) => branch.id,
);
export function isFinanceDataBranch(id: string): boolean {
  return FINANCE_DATA_BRANCH_IDS.includes(id);
}
