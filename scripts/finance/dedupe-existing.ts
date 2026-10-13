import { createScriptPrismaClient, Prisma } from '@personal-os/database';

const TRANSACTION_ENTITY = 'transaction';
const TRANSACTION_MODEL = 'FinTransaction';
const TRANSACTION_STATUS_CONFIRMED = 'CONFIRMED';
const TRANSACTION_STATUS_REVERSED = 'REVERSED';
const RETENTION_DAYS = 30;
const MONEY_PRECISION = 100;

type TxClient = Prisma.TransactionClient;

type MovementRow = {
  id: string;
  userId: string;
  accountId: string | null;
  categoryId: string | null;
  status: string;
  amount: { toString(): string };
  ledgerAmount: { toString(): string };
  amountBaseCurrency: { toString(): string };
  transactionDate: Date;
};

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
      data: {
        amountSpent: { increment: -Math.abs(input.amountBaseCurrency) },
      },
    });
  }
}

/** Deletes one duplicate movement, compensating its ledger and budget effect. */
async function removeTransaction(
  prisma: ReturnType<typeof createScriptPrismaClient>,
  movement: MovementRow,
): Promise<void> {
  const amount = roundMoney(Number(movement.ledgerAmount ?? movement.amount));
  await prisma.$transaction(async (tx) => {
    if (movement.status === TRANSACTION_STATUS_CONFIRMED) {
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
    }
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
  });
}

async function hasPlanningLinks(
  prisma: ReturnType<typeof createScriptPrismaClient>,
  ids: readonly string[],
): Promise<boolean> {
  const [payment, contribution, installment] = await Promise.all([
    prisma.finReceivablePayment.count({
      where: { transactionId: { in: [...ids] } },
    }),
    prisma.finSavingsGoalContribution.count({
      where: { transactionId: { in: [...ids] } },
    }),
    prisma.finLoanInstallment.count({
      where: { transactionId: { in: [...ids] } },
    }),
  ]);
  return payment + contribution + installment > 0;
}

/**
 * Removes the bank-reference duplicates that would block the partial unique
 * index, and the duplicated reversals. The oldest row of each group wins; the
 * rest are deleted through the deletion journal with balance and budget
 * compensation. Idempotent. Run `--dry-run` first, with a journal backup.
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = createScriptPrismaClient();

  const referenceGroups = await prisma.finTransaction.groupBy({
    by: ['userId', 'institutionId', 'externalReference'],
    where: {
      externalReference: { not: null },
      institutionId: { not: null },
      status: { not: TRANSACTION_STATUS_REVERSED },
    },
    _count: { _all: true },
  });

  for (const group of referenceGroups) {
    if (group._count._all < 2) {
      continue;
    }
    const rows = await prisma.finTransaction.findMany({
      where: {
        userId: group.userId,
        institutionId: group.institutionId,
        externalReference: group.externalReference,
        status: { not: TRANSACTION_STATUS_REVERSED },
      },
      orderBy: { createdAt: 'asc' },
    });
    const [keep, ...duplicates] = rows;
    process.stdout.write(
      `reference ${group.externalReference}: keep ${keep.id}, drop ${duplicates
        .map((row) => row.id)
        .join(', ')}\n`,
    );
    if (dryRun) {
      continue;
    }
    if (
      await hasPlanningLinks(
        prisma,
        duplicates.map((row) => row.id),
      )
    ) {
      process.stdout.write(
        `  skip: one duplicate is linked to planning, resolve by hand\n`,
      );
      continue;
    }
    for (const duplicate of duplicates) {
      await removeTransaction(prisma, duplicate as MovementRow);
    }
  }

  const reverseGroups = await prisma.finTransaction.groupBy({
    by: ['linkedTransactionId'],
    where: { linkedTransactionId: { not: null } },
    _count: { _all: true },
  });

  for (const group of reverseGroups) {
    if (group._count._all < 2) {
      continue;
    }
    const rows = await prisma.finTransaction.findMany({
      where: { linkedTransactionId: group.linkedTransactionId },
      orderBy: { createdAt: 'asc' },
    });
    const [keep, ...duplicates] = rows;
    process.stdout.write(
      `reverse of ${group.linkedTransactionId}: keep ${keep.id}, drop ${duplicates
        .map((row) => row.id)
        .join(', ')}\n`,
    );
    if (dryRun) {
      continue;
    }
    if (
      await hasPlanningLinks(
        prisma,
        duplicates.map((row) => row.id),
      )
    ) {
      process.stdout.write(
        `  skip: one duplicate reverse is linked to planning, resolve by hand\n`,
      );
      continue;
    }
    for (const duplicate of duplicates) {
      await removeTransaction(prisma, duplicate as MovementRow);
    }
  }

  await prisma.$disconnect();
}

void main();
