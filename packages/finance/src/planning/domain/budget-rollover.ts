import { roundMoney } from '../../shared/domain/money';

export const BUDGET_ROLLOVER = {
  NONE: 'NONE',
  SURPLUS: 'SURPLUS',
  SURPLUS_AND_DEFICIT: 'SURPLUS_AND_DEFICIT',
} as const;

export type BudgetRollover =
  (typeof BUDGET_ROLLOVER)[keyof typeof BUDGET_ROLLOVER];

/**
 * What carries into the next period. `SURPLUS` keeps only money left over;
 * `SURPLUS_AND_DEFICIT` also pulls a negative balance forward.
 */
export function carriedOverFrom(input: {
  rollover: BudgetRollover;
  previousLimit: number;
  previousCarriedOver: number;
  previousSpent: number;
}): number {
  if (input.rollover === BUDGET_ROLLOVER.NONE) {
    return 0;
  }
  const leftover = roundMoney(
    input.previousLimit + input.previousCarriedOver - input.previousSpent,
  );
  if (input.rollover === BUDGET_ROLLOVER.SURPLUS) {
    return Math.max(0, leftover);
  }
  return leftover;
}
