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
 *
 * Credit cards are products on their own. Debit cards hang from an account, so
 * they are wiped with the accounts and never with the credit cards.
 *
 * Billed-from imports follow their owner: the ones billed from a card travel
 * with the card statements and the ones billed from an account with the
 * accounts, so no import is deleted without its count on screen.
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
    label: 'Tarjetas de crédito',
    includes: [
      'finance.reconciliations',
      'finance.transactions',
      'finance.statements',
    ],
    order: 6,
  },
  {
    id: 'finance.debitCards',
    app: DATA_APP.FINANCE,
    label: 'Tarjetas de débito',
    includes: [],
    order: 7,
  },
  {
    id: 'finance.accountImports',
    app: DATA_APP.FINANCE,
    label: 'Importaciones de cuentas',
    includes: [],
    order: 8,
  },
  {
    id: 'finance.accounts',
    app: DATA_APP.FINANCE,
    label: 'Cuentas, incluido el efectivo',
    includes: [
      'finance.reconciliations',
      'finance.transactions',
      'finance.loans',
      'finance.debitCards',
      'finance.accountImports',
    ],
    order: 9,
  },
  {
    id: 'finance.institutions',
    app: DATA_APP.FINANCE,
    label: 'Instituciones',
    includes: [
      'finance.accounts',
      'finance.cards',
      'finance.debitCards',
      'finance.loans',
    ],
    order: 10,
  },
  {
    id: 'finance.subscriptions',
    app: DATA_APP.FINANCE,
    label: 'Suscripciones',
    includes: [],
    order: 11,
  },
  {
    id: 'finance.recurring',
    app: DATA_APP.FINANCE,
    label: 'Recurrentes detectados',
    includes: [],
    order: 12,
  },
  {
    id: 'finance.merchants',
    app: DATA_APP.FINANCE,
    label: 'Comercios',
    includes: [],
    order: 13,
  },
  {
    id: 'finance.savingsGoals',
    app: DATA_APP.FINANCE,
    label: 'Metas de ahorro',
    includes: [],
    order: 14,
  },
  {
    id: 'finance.receivables',
    app: DATA_APP.FINANCE,
    label: 'Cobros',
    includes: [],
    order: 15,
  },
  {
    id: 'finance.budgets',
    app: DATA_APP.FINANCE,
    label: 'Presupuestos',
    includes: [],
    order: 16,
  },
  {
    id: 'finance.categories',
    app: DATA_APP.FINANCE,
    label: 'Categorías propias',
    includes: ['finance.budgets'],
    order: 17,
  },
];
export const FINANCE_DATA_BRANCH_IDS = FINANCE_DATA_BRANCHES.map(
  (branch) => branch.id,
);
export function isFinanceDataBranch(id: string): boolean {
  return FINANCE_DATA_BRANCH_IDS.includes(id);
}
