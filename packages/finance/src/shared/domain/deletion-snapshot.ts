export const DELETION_ENTITY = {
  account: 'account',
  budget: 'budget',
  card: 'card',
  category: 'category',
  institution: 'institution',
  loan: 'loan',
  receivable: 'receivable',
  reconciliation: 'reconciliation',
  savingsGoal: 'savingsGoal',
  transaction: 'transaction',
} as const;

export type DeletionEntity =
  (typeof DELETION_ENTITY)[keyof typeof DELETION_ENTITY];

export const DELETION_MODEL = {
  account: 'FinAccount',
  budget: 'FinBudget',
  budgetAlert: 'FinBudgetAlert',
  card: 'FinCard',
  cardBalance: 'FinCardBalance',
  cardStatement: 'FinCardStatement',
  category: 'FinCategory',
  institution: 'FinInstitution',
  loan: 'FinLoan',
  loanInstallment: 'FinLoanInstallment',
  receivable: 'FinReceivable',
  receivablePayment: 'FinReceivablePayment',
  reconciliation: 'FinReconciliation',
  reconciliationAdjustment: 'FinReconciliationAdjustment',
  savingsGoal: 'FinSavingsGoal',
  savingsGoalContribution: 'FinSavingsGoalContribution',
  transaction: 'FinTransaction',
} as const;

export type DeletionModel =
  (typeof DELETION_MODEL)[keyof typeof DELETION_MODEL];

/** One row to put back, with the model it belongs to and its stored columns. */
export type DeletionRow = {
  model: DeletionModel;
  values: Record<string, unknown>;
};

/**
 * A movement as the journal stores it: plain JSON, so dates are strings and
 * decimals are strings or numbers.
 */
export type StoredMovement = {
  id: string;
  accountId: string | null;
  cardId: string | null;
  type: string;
  status: string;
  amount: string | number;
  ledgerAmount?: string | number | null;
  ledgerCurrency?: string | null;
  amountBaseCurrency?: string | number | null;
  currency: string;
  categoryId: string | null;
  transactionDate: string;
};

export type ClearedCategory = {
  transactionId: string;
  categoryId: string;
};

/** A row whose account link the database cleared when the account was deleted. */
export type ClearedAccountLink = {
  model: DeletionModel;
  rowId: string;
  accountId: string;
};

/** A row the delete changed in place, with the values it had before. */
export type UpdatedRow = {
  model: DeletionModel;
  id: string;
  values: Record<string, unknown>;
};

export const ALREADY_RESTORED = 'ALREADY_RESTORED';
export const ALREADY_RESTORED_MESSAGE = 'Esto ya se restauró.';
export const RESTORE_CONFLICT = 'RESTORE_CONFLICT';
export const RESTORE_CONFLICT_MESSAGE =
  'No se puede restaurar: ya existe un registro con los mismos datos.';
export const PARTIAL_OPERATION = 'PARTIAL_OPERATION';
export const PARTIAL_OPERATION_MESSAGE =
  'Esta operación está incompleta. Restaura la operación completa.';

/** What a restore attempt did: nothing missing, nothing already done. */
export type RestoreResult = {
  count: number;
  alreadyRestored: boolean;
};

/**
 * What a delete removed. `rows` goes back in order, parent before child,
 * `updates` puts back rows that were changed instead of removed, and the
 * cleared lists restore the links the database nulled on cascade.
 */
export type DeletionSnapshot = {
  rows: DeletionRow[];
  updates?: UpdatedRow[];
  ledgerReversed?: string[];
  categoriesCleared?: ClearedCategory[];
  accountsCleared?: ClearedAccountLink[];
};

/**
 * Plain JSON copy of a row so it survives the journal round trip: decimals
 * become strings and dates become ISO strings, both valid on create.
 */
export function toDeletionValues(row: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

/** The movements in a snapshot whose balance and budget effect was reversed. */
export function reversedMovements(
  snapshot: DeletionSnapshot,
): StoredMovement[] {
  const reversed = new Set(snapshot.ledgerReversed ?? []);
  return snapshot.rows
    .filter(
      (row) =>
        row.model === DELETION_MODEL.transaction &&
        reversed.has(String(row.values.id)),
    )
    .map((row) => row.values as unknown as StoredMovement);
}
