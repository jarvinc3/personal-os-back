import { roundMoney } from '../../shared/domain/money';

export type SavingsGoalProgress = {
  currentAmount: number;
  isCompleted: boolean;
};

export type SavingsGoalAllocation = {
  amount: number;
  kind: 'CONTRIBUTION' | 'WITHDRAWAL';
  transactionId?: string | null;
};

/**
 * The recorded allocations are the only source of a goal balance. Drawings
 * return money and always subtract; a drawing tied to an expense subtracts only
 * when the goal lets spending reduce progress.
 */
export function resolveSavingsGoalProgress(input: {
  targetAmount: number;
  allocations: readonly SavingsGoalAllocation[];
  spendReducesProgress?: boolean;
}): SavingsGoalProgress {
  const spendReduces = input.spendReducesProgress ?? true;
  const contributedAmount = input.allocations.reduce((sum, allocation) => {
    if (allocation.kind !== 'WITHDRAWAL') {
      return sum + allocation.amount;
    }
    if (!spendReduces && allocation.transactionId) {
      return sum;
    }
    return sum - allocation.amount;
  }, 0);
  const currentAmount = roundMoney(contributedAmount);
  return {
    currentAmount,
    isCompleted: currentAmount >= input.targetAmount,
  };
}
