import { roundMoney } from '../../shared/domain/money';

export type SavingsGoalProgress = {
  currentAmount: number;
  isCompleted: boolean;
};

/**
 * The recorded contributions are the only source of a goal balance, so the
 * cached amount and the completion flag always come from their sum.
 */
export function resolveSavingsGoalProgress(input: {
  targetAmount: number;
  contributedAmount: number;
}): SavingsGoalProgress {
  const currentAmount = roundMoney(input.contributedAmount);
  return {
    currentAmount,
    isCompleted: currentAmount >= input.targetAmount,
  };
}
