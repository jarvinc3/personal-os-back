import type { FinanceWipeBranches } from './finance-wipe-branch';

/** Subscriptions, recurring patterns and the planning aggregates. */
export function planningWipeBranches(): FinanceWipeBranches {
  return {
    'finance.subscriptions': {
      apply: async (tx, { userId }) => {
        await tx.finSubscriptionPayment.deleteMany({
          where: { subscription: { userId } },
        });
        await tx.finSubscriptionAlertDismissal.deleteMany({
          where: { userId },
        });
        const subscriptions = await tx.finSubscription.deleteMany({
          where: { userId },
        });
        return subscriptions.count;
      },
      count: (prisma, userId) =>
        prisma.finSubscription.count({ where: { userId } }),
    },
    'finance.recurring': {
      apply: async (tx, { userId }) => {
        const patterns = await tx.finRecurringPattern.deleteMany({
          where: { userId },
        });
        return patterns.count;
      },
      count: (prisma, userId) =>
        prisma.finRecurringPattern.count({ where: { userId } }),
    },
    'finance.loans': {
      apply: async (tx, { userId }) => {
        const loans = await tx.finLoan.deleteMany({ where: { userId } });
        return loans.count;
      },
      count: (prisma, userId) => prisma.finLoan.count({ where: { userId } }),
    },
    'finance.savingsGoals': {
      apply: async (tx, { userId }) => {
        const goals = await tx.finSavingsGoal.deleteMany({ where: { userId } });
        return goals.count;
      },
      count: (prisma, userId) =>
        prisma.finSavingsGoal.count({ where: { userId } }),
    },
    'finance.receivables': {
      apply: async (tx, { userId }) => {
        const receivables = await tx.finReceivable.deleteMany({
          where: { userId },
        });
        return receivables.count;
      },
      count: (prisma, userId) =>
        prisma.finReceivable.count({ where: { userId } }),
    },
    'finance.budgets': {
      apply: async (tx, { userId }) => {
        const budgets = await tx.finBudget.deleteMany({ where: { userId } });
        return budgets.count;
      },
      count: (prisma, userId) => prisma.finBudget.count({ where: { userId } }),
    },
  };
}
