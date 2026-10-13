import { createScriptPrismaClient, Prisma } from '@personal-os/database';

const TRANSACTION_ENTITY = 'transaction';
const TRANSACTION_MODEL = 'FinTransaction';
const TRANSACTION_STATUS_CONFIRMED = 'CONFIRMED';
const RETENTION_DAYS = 30;
const MONEY_PRECISION = 100;

type TxClient = Prisma.TransactionClient;

function roundMoney(value: number): number {
  return Math.round(value * MONEY_PRECISION) / MONEY_PRECISION;
}

/** Mirrors `adjustBudgetSpent` for a single movement being removed. */
async function decrementBudgetSpent(
  tx: TxClient,
  input: {
    userId: string;
    categoryId: string | null;
    amountBaseCurrency: number;
    transactionDate: Date;
  },
): Promise<void> {
  if (!input.categoryId || input.amountBaseCurrency === 0) {
    return;
  }
  const dateOnly = new Date(input.transactionDate);
  dateOnly.setUTCHours(0, 0, 0, 0);
  const budgets = await tx.finBudget.findMany({
    where: {
      userId: input.userId,
      periodStart: { lte: dateOnly },
      periodEnd: { gte: dateOnly },
      OR: [
        { categoryId: input.categoryId },
        { categories: { some: { categoryId: input.categoryId } } },
        {
          includeChildren: true,
          categories: {
            some: { category: { parentId: input.categoryId } },
          },
        },
      ],
    },
  });
  for (const budget of budgets) {
    await tx.finBudget.update({
      where: { id: budget.id },
      data: { amountSpent: { increment: -Math.abs(input.amountBaseCurrency) } },
    });
  }
}

/**
 * Turns old "Aporte: ..." movements into plain allocations. Before this phase a
 * contribution created a DEBIT, so the money left the account; now an
 * allocation only earmarks it. This deletes those movements, restores the
 * account balance and the budget spent, clears `transaction_id`, and keeps a
 * deletion-journal entry so the removal is auditable and reversible. It does
 * not touch the goal balance: the contribution stays. Idempotent. Run
 * `--dry-run` first.
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = createScriptPrismaClient();
  const contributions = await prisma.finSavingsGoalContribution.findMany({
    where: { transactionId: { not: null } },
  });

  for (const contribution of contributions) {
    const movement = await prisma.finTransaction.findUnique({
      where: { id: contribution.transactionId ?? '' },
    });
    if (!movement || movement.status !== TRANSACTION_STATUS_CONFIRMED) {
      process.stdout.write(
        `contribution ${contribution.id}: no confirmed movement, clearing link\n`,
      );
      if (!dryRun) {
        await prisma.finSavingsGoalContribution.update({
          where: { id: contribution.id },
          data: { transactionId: null },
        });
      }
      continue;
    }

    const amount = roundMoney(Number(movement.ledgerAmount ?? movement.amount));
    process.stdout.write(
      `contribution ${contribution.id}: restore ${amount} to ${movement.accountId}\n`,
    );
    if (dryRun) {
      continue;
    }

    await prisma.$transaction(async (tx) => {
      if (movement.accountId) {
        await tx.finAccount.update({
          where: { id: movement.accountId },
          data: { balance: { increment: amount } },
        });
      }
      await decrementBudgetSpent(tx, {
        userId: movement.userId,
        categoryId: movement.categoryId,
        amountBaseCurrency: Number(
          movement.amountBaseCurrency ?? movement.amount,
        ),
        transactionDate: movement.transactionDate,
      });
      const now = new Date();
      const snapshot = {
        rows: [
          {
            model: TRANSACTION_MODEL,
            values: JSON.parse(JSON.stringify(movement)) as Record<
              string,
              unknown
            >,
          },
        ],
        ledgerReversed: [movement.id],
      };
      await tx.finDeletionJournal.create({
        data: {
          userId: movement.userId,
          entityType: TRANSACTION_ENTITY,
          entityId: movement.id,
          snapshot: snapshot as Prisma.InputJsonValue,
          sizeBytes: Buffer.byteLength(JSON.stringify(snapshot), 'utf8'),
          expiresAt: new Date(
            now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000,
          ),
        },
      });
      await tx.finTransaction.delete({ where: { id: movement.id } });
      await tx.finSavingsGoalContribution.update({
        where: { id: contribution.id },
        data: { transactionId: null },
      });
    });
  }

  await prisma.$disconnect();
}

void main();
