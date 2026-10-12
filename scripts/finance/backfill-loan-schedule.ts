import { PrismaClient } from '@personal-os/database';

/**
 * Recalculates each loan balance as `originalAmount - paid principal`, so a
 * loan that was paid before the French schedule existed stops counting the
 * interest as balance. Idempotent. Run with `--dry-run` first.
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();
  const loans = await prisma.finLoan.findMany({
    include: { installments: true },
  });

  for (const loan of loans) {
    const paidPrincipal = loan.installments
      .filter((installment) => installment.paidAt !== null)
      .reduce((sum, installment) => sum + Number(installment.principal), 0);
    const newBalance =
      Math.round((Number(loan.originalAmount) - paidPrincipal) * 100) / 100;
    if (newBalance === Number(loan.currentBalance)) {
      continue;
    }
    process.stdout.write(
      `${loan.id}: ${loan.currentBalance.toString()} -> ${newBalance}\n`,
    );
    if (!dryRun) {
      await prisma.finLoan.update({
        where: { id: loan.id },
        data: { currentBalance: newBalance },
      });
    }
  }

  await prisma.$disconnect();
}

void main();
