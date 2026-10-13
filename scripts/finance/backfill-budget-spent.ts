import { createScriptPrismaClient } from '@personal-os/database';

const TRANSACTION_TYPE_DEBIT = 'DEBIT';
const TRANSACTION_TYPE_CREDIT = 'CREDIT';
const TRANSACTION_STATUS_CONFIRMED = 'CONFIRMED';
const MONEY_PRECISION = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

function roundMoney(value: number): number {
  return Math.round(value * MONEY_PRECISION) / MONEY_PRECISION;
}

function endOfUtcDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
}

/**
 * Recomputes `amountSpent` of every budget with the current rules: the whole
 * category set, subcategories when `includeChildren`, refunds subtract, and no
 * transfer legs, card payments or adjustments. Idempotent. Run `--dry-run`
 * first; the numbers can go up when subcategories start counting.
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = createScriptPrismaClient();
  const budgets = await prisma.finBudget.findMany({
    include: { categories: true },
  });

  for (const budget of budgets) {
    const rootIds = budget.categories.map((entry) => entry.categoryId);
    if (rootIds.length === 0) {
      continue;
    }
    const categoryIds = budget.includeChildren
      ? [
          ...rootIds,
          ...(
            await prisma.finCategory.findMany({
              where: { parentId: { in: rootIds } },
              select: { id: true },
            })
          ).map((row) => row.id),
        ]
      : rootIds;

    const window = {
      gte: budget.periodStart,
      lte: endOfUtcDay(budget.periodEnd),
    };
    const [debits, credits] = await Promise.all([
      prisma.finTransaction.aggregate({
        _sum: { amountBaseCurrency: true },
        where: {
          userId: budget.userId,
          type: TRANSACTION_TYPE_DEBIT,
          status: TRANSACTION_STATUS_CONFIRMED,
          transferGroupId: null,
          categoryId: { in: categoryIds },
          transactionDate: window,
        },
      }),
      prisma.finTransaction.aggregate({
        _sum: { amountBaseCurrency: true },
        where: {
          userId: budget.userId,
          type: TRANSACTION_TYPE_CREDIT,
          status: TRANSACTION_STATUS_CONFIRMED,
          transferGroupId: null,
          categoryId: { in: categoryIds },
          transactionDate: window,
        },
      }),
    ]);
    const amountSpent = roundMoney(
      Number(debits._sum.amountBaseCurrency ?? 0) -
        Number(credits._sum.amountBaseCurrency ?? 0),
    );
    const current = roundMoney(Number(budget.amountSpent));
    if (amountSpent === current) {
      continue;
    }
    process.stdout.write(
      `budget ${budget.id}: amountSpent ${current} -> ${amountSpent}\n`,
    );
    if (dryRun) {
      continue;
    }
    await prisma.finBudget.update({
      where: { id: budget.id },
      data: { amountSpent },
    });
  }

  await prisma.$disconnect();
}

void main();
