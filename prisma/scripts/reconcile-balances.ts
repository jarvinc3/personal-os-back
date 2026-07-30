/**
 * One-shot reconciliation: recompute FinAccount.balance, FinCardBalance.balance,
 * and FinBudget.amountSpent from CONFIRMED ledger rows.
 *
 * Usage (from personal-os-back):
 *   pnpm exec ts-node -r tsconfig-paths/register prisma/scripts/reconcile-balances.ts
 *
 * Requires DATABASE_URL. Safe to re-run (idempotent overwrite).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaClient } from '../../src/prisma/generated/client';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const accounts = await prisma.finAccount.findMany({ select: { id: true } });
    for (const account of accounts) {
      const agg = await prisma.finTransaction.aggregate({
        where: {
          accountId: account.id,
          status: 'CONFIRMED',
        },
        _sum: { amount: true },
      });

      const txs = await prisma.finTransaction.findMany({
        where: { accountId: account.id, status: 'CONFIRMED' },
        select: { type: true, amount: true },
      });
      let balance = 0;
      for (const tx of txs) {
        balance += tx.type === 'CREDIT' ? Number(tx.amount) : -Math.abs(Number(tx.amount));
      }
      void agg;
      await prisma.finAccount.update({
        where: { id: account.id },
        data: { balance },
      });
    }

    const cards = await prisma.finCard.findMany({ select: { id: true } });
    for (const card of cards) {
      const currencies = await prisma.finTransaction.findMany({
        where: { cardId: card.id, status: 'CONFIRMED' },
        select: { currency: true },
        distinct: ['currency'],
      });
      for (const { currency } of currencies) {
        const txs = await prisma.finTransaction.findMany({
          where: { cardId: card.id, status: 'CONFIRMED', currency },
          select: { type: true, amount: true },
        });
        let balance = 0;
        for (const tx of txs) {
          balance += tx.type === 'CREDIT' ? Number(tx.amount) : -Math.abs(Number(tx.amount));
        }
        const existing = await prisma.finCardBalance.findFirst({
          where: { cardId: card.id, currency },
        });
        if (existing) {
          await prisma.finCardBalance.update({
            where: { id: existing.id },
            data: { balance },
          });
        } else {
          await prisma.finCardBalance.create({
            data: { cardId: card.id, currency, balance },
          });
        }
      }
    }

    const budgets = await prisma.finBudget.findMany();
    for (const budget of budgets) {
      const agg = await prisma.finTransaction.aggregate({
        where: {
          userId: budget.userId,
          categoryId: budget.categoryId,
          type: 'DEBIT',
          status: 'CONFIRMED',
          transactionDate: {
            gte: budget.periodStart,
            lte: budget.periodEnd,
          },
        },
        _sum: { amountBaseCurrency: true },
      });
      await prisma.finBudget.update({
        where: { id: budget.id },
        data: { amountSpent: agg._sum.amountBaseCurrency ?? 0 },
      });
    }

    console.log(
      `Reconciled ${accounts.length} accounts, ${cards.length} cards, ${budgets.length} budgets.`,
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
