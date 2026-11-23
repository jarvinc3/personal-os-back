import type { FinanceWipeBranches, FinanceWipeTx } from './finance-wipe-branch';

/**
 * Non-system institutions go, and with them their accounts, cards and what
 * those drag. The system "Efectivo" institution survives.
 */
async function wipeInstitutions(
  tx: FinanceWipeTx,
  userId: string,
): Promise<number> {
  const institutions = await tx.finInstitution.findMany({
    where: { userId, isSystem: false },
    select: { id: true },
  });
  const institutionIds = institutions.map((institution) => institution.id);
  await tx.finLoan.deleteMany({
    where: { userId, institutionId: { in: institutionIds } },
  });
  // Accounts, cards and mail sources (with their messages) cascade.
  const deleted = await tx.finInstitution.deleteMany({
    where: { userId, isSystem: false },
  });
  return deleted.count;
}

/** Cards, accounts, institutions, merchants and categories. */
export function catalogWipeBranches(): FinanceWipeBranches {
  return {
    'finance.cards': {
      apply: async (tx, { userId }) => {
        const cards = await tx.finCard.deleteMany({
          where: { userId, type: 'CREDIT' },
        });
        return cards.count;
      },
      count: (prisma, userId) =>
        prisma.finCard.count({ where: { userId, type: 'CREDIT' } }),
    },
    'finance.debitCards': {
      apply: async (tx, { userId }) => {
        const cards = await tx.finCard.deleteMany({
          where: { userId, type: 'DEBIT' },
        });
        return cards.count;
      },
      count: (prisma, userId) =>
        prisma.finCard.count({ where: { userId, type: 'DEBIT' } }),
    },
    'finance.accounts': {
      apply: async (tx, { userId }) => {
        const accounts = await tx.finAccount.deleteMany({ where: { userId } });
        return accounts.count;
      },
      count: (prisma, userId) => prisma.finAccount.count({ where: { userId } }),
    },
    'finance.institutions': {
      apply: (tx, { userId }) => wipeInstitutions(tx, userId),
      count: (prisma, userId) =>
        prisma.finInstitution.count({ where: { userId, isSystem: false } }),
    },
    'finance.merchants': {
      apply: async (tx, { userId }) => {
        const merchants = await tx.finMerchant.deleteMany({
          where: { userId },
        });
        return merchants.count;
      },
      count: (prisma, userId) =>
        prisma.finMerchant.count({ where: { userId } }),
    },
    'finance.categories': {
      apply: async (tx, { userId }) => {
        const categories = await tx.finCategory.deleteMany({
          where: { userId, isSystem: false },
        });
        return categories.count;
      },
      count: (prisma, userId) =>
        prisma.finCategory.count({ where: { userId, isSystem: false } }),
    },
  };
}
