import { PrismaClient } from '@personal-os/database';

/**
 * Turns old "Aporte: …" movements into plain allocations. Before this phase a
 * contribution created a DEBIT, so the money left the account; now an
 * allocation only earmarks it. This deletes those movements, restores the
 * account balance and clears `transaction_id`. Idempotent. Run `--dry-run`
 * first, and back up `fin_deletion_journal` before running it.
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();
  const contributions = await prisma.finSavingsGoalContribution.findMany({
    where: { transactionId: { not: null } },
  });

  for (const contribution of contributions) {
    const movement = await prisma.finTransaction.findUnique({
      where: { id: contribution.transactionId ?? '' },
    });
    if (!movement || movement.status !== 'CONFIRMED') {
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

    const amount = Number(movement.ledgerAmount ?? movement.amount);
    process.stdout.write(
      `contribution ${contribution.id}: restore ${amount} to ${movement.accountId}\n`,
    );
    if (dryRun) {
      continue;
    }
    await prisma.$transaction([
      ...(movement.accountId
        ? [
            prisma.finAccount.update({
              where: { id: movement.accountId },
              data: { balance: { increment: amount } },
            }),
          ]
        : []),
      prisma.finTransaction.delete({ where: { id: movement.id } }),
      prisma.finSavingsGoalContribution.update({
        where: { id: contribution.id },
        data: { transactionId: null },
      }),
    ]);
  }

  await prisma.$disconnect();
}

void main();
