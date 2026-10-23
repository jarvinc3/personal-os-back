import { Prisma, type PrismaService } from '@personal-os/database';
import { endOfUtcDay } from '../domain/local-day';
import { roundDecimal } from '../domain/money';

export type BudgetSpentScope = {
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  /** Categories the budget covers, without their children. */
  categoryIds: readonly string[];
  includeChildren: boolean;
};

/** Categories a budget row covers; `categoryId` covers rows from before the join table. */
export function budgetCategoryIds(budget: {
  categoryId?: string | null;
  categories?: ReadonlyArray<{ categoryId: string }>;
}): string[] {
  const fromJoin = (budget.categories ?? []).map((entry) => entry.categoryId);
  const legacy = budget.categoryId ? [budget.categoryId] : [];
  return [...new Set([...legacy, ...fromJoin])];
}

/**
 * Spent money summed from the movements the budget covers. The interface shows
 * this figure, so it can never disagree with the budget's movement list.
 */
export async function sumBudgetSpent(
  prisma: PrismaService,
  scope: BudgetSpentScope,
): Promise<Prisma.Decimal> {
  const categoryIds = await categoriesWithChildren(prisma, scope);
  if (categoryIds.length === 0) {
    return roundDecimal(0);
  }

  const total = await prisma.finTransaction.aggregate({
    where: {
      userId: scope.userId,
      type: 'DEBIT',
      status: 'CONFIRMED',
      categoryId: { in: categoryIds },
      transactionDate: {
        gte: scope.periodStart,
        lte: endOfUtcDay(scope.periodEnd),
      },
    },
    _sum: { amountBaseCurrency: true },
  });

  return roundDecimal(total._sum.amountBaseCurrency ?? 0);
}

async function categoriesWithChildren(
  prisma: PrismaService,
  scope: BudgetSpentScope,
): Promise<string[]> {
  if (!scope.includeChildren || scope.categoryIds.length === 0) {
    return [...scope.categoryIds];
  }

  const children = await prisma.finCategory.findMany({
    where: { parentId: { in: [...scope.categoryIds] } },
    select: { id: true },
  });

  return [...new Set([...scope.categoryIds, ...children.map((row) => row.id)])];
}
