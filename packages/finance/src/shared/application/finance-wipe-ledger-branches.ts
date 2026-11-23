import { NotFoundException } from '@nestjs/common';
import type { FinanceWipeBranches, FinanceWipeTx } from './finance-wipe-branch';
import { resetCardBalances } from './finance-wipe-balance-helpers';

async function resetBalances(
  tx: FinanceWipeTx,
  userId: string,
  institutionId?: string,
): Promise<number> {
  if (institutionId) {
    const institution = await tx.finInstitution.findFirst({
      where: { id: institutionId, userId },
      select: { id: true },
    });
    if (!institution) {
      throw new NotFoundException('Institución no encontrada');
    }
  }
  const accounts = await tx.finAccount.updateMany({
    where: institutionId ? { userId, institutionId } : { userId },
    data: { balance: 0 },
  });
  const cardBalances = await resetCardBalances(tx, userId, institutionId);
  return accounts.count + cardBalances;
}

/** Ledger, balances and statement imports, with their own count rule. */
export function ledgerWipeBranches(): FinanceWipeBranches {
  return {
    'finance.reconciliations': {
      apply: async (tx, { userId }) => {
        const reconciliations = await tx.finReconciliation.deleteMany({
          where: { userId },
        });
        const drifts = await tx.finBalanceDrift.deleteMany({
          where: { userId },
        });
        return reconciliations.count + drifts.count;
      },
      count: async (prisma, userId) =>
        (await prisma.finReconciliation.count({ where: { userId } })) +
        (await prisma.finBalanceDrift.count({
          where: { userId, resolvedAt: null },
        })),
    },
    'finance.transactions': {
      apply: async (tx, { userId }) => {
        const signalImports = await tx.finSignalImport.deleteMany({
          where: { userId },
        });
        const transactions = await tx.finTransaction.deleteMany({
          where: { userId },
        });
        await tx.finAccount.updateMany({
          where: { userId },
          data: { balance: 0 },
        });
        await resetCardBalances(tx, userId);
        await tx.finBudget.updateMany({
          where: { userId },
          data: { amountSpent: 0 },
        });
        return transactions.count + signalImports.count;
      },
      count: async (prisma, userId) =>
        (await prisma.finTransaction.count({ where: { userId } })) +
        (await prisma.finSignalImport.count({ where: { userId } })),
    },
    'finance.balances': {
      apply: (tx, { userId, balanceInstitutionId }) =>
        resetBalances(tx, userId, balanceInstitutionId),
      count: async (prisma, userId) =>
        (await prisma.finAccount.count({ where: { userId } })) +
        (await prisma.finCardBalance.count({ where: { card: { userId } } })),
    },
    'finance.statements': {
      // The split by account is disjoint: an import billed from an account
      // travels with the accounts and the rest stays here, so each row is
      // counted by exactly one branch.
      apply: async (tx, { userId }) => {
        const imports = await tx.finStatementImport.deleteMany({
          where: { userId, accountId: null },
        });
        const statements = await tx.finCardStatement.deleteMany({
          where: { card: { userId } },
        });
        return imports.count + statements.count;
      },
      count: async (prisma, userId) =>
        (await prisma.finStatementImport.count({
          where: { userId, accountId: null },
        })) +
        (await prisma.finCardStatement.count({ where: { card: { userId } } })),
    },
    'finance.accountImports': {
      apply: async (tx, { userId }) => {
        const imports = await tx.finStatementImport.deleteMany({
          where: { userId, accountId: { not: null } },
        });
        return imports.count;
      },
      count: (prisma, userId) =>
        prisma.finStatementImport.count({
          where: { userId, accountId: { not: null } },
        }),
    },
  };
}
