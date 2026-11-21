/**
 * Finance products the bulk lookup can resolve. Each type maps to the public
 * shape of its own endpoint; the identifiers are part of the HTTP contract.
 */
export const FINANCE_ENTITY_TYPE = {
  TRANSACTION: 'transaction',
  ACCOUNT: 'account',
  CARD: 'card',
  LOAN: 'loan',
  BUDGET: 'budget',
  SAVINGS_GOAL: 'savingsGoal',
  RECEIVABLE: 'receivable',
  SUBSCRIPTION: 'subscription',
  MERCHANT: 'merchant',
  CATEGORY: 'category',
  INSTITUTION: 'institution',
} as const;

export type FinanceEntityType =
  (typeof FINANCE_ENTITY_TYPE)[keyof typeof FINANCE_ENTITY_TYPE];

export const FINANCE_ENTITY_TYPES = Object.values(
  FINANCE_ENTITY_TYPE,
) as FinanceEntityType[];

export type FinanceEntityRef = {
  type: FinanceEntityType;
  id: string;
};

/** Upper bound per call, so the batch stays one query per type. */
export const MAX_ENTITY_REFS = 50;

export function entityRefKey(ref: FinanceEntityRef): string {
  return `${ref.type}:${ref.id}`;
}
