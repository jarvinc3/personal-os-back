import type { Prisma } from '@personal-os/database';
import { resolveSavingsGoalProgress } from '../domain/savings-goal-progress';

/**
 * Recompute the cached amount and completion flag of a goal from its
 * contributions inside the caller's transaction. The ledger uses it as well, so
 * adding a contribution and undoing its movement stay one rule.
 */
export async function applySavingsGoalBalance(
  tx: Prisma.TransactionClient,
  goalId: string,
  now: Date,
): Promise<void> {
  const goal = await tx.finSavingsGoal.findUniqueOrThrow({
    where: { id: goalId },
  });
  const contributions = await tx.finSavingsGoalContribution.aggregate({
    where: { goalId },
    _sum: { amount: true },
  });
  const progress = resolveSavingsGoalProgress({
    targetAmount: Number(goal.targetAmount),
    contributedAmount: Number(contributions._sum.amount ?? 0),
  });
  await tx.finSavingsGoal.update({
    where: { id: goalId },
    data: {
      currentAmount: progress.currentAmount,
      isCompleted: progress.isCompleted,
      completedAt: progress.isCompleted ? (goal.completedAt ?? now) : null,
    },
  });
}
