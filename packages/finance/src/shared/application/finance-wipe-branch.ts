import type { Prisma, PrismaService } from '@personal-os/database';

export type FinanceWipeTx = Prisma.TransactionClient;

export type FinanceWipeBranchInput = {
  userId: string;
  balanceInstitutionId?: string;
};

/** One data branch: what it removes and how many rows it would count today. */
export type FinanceWipeBranch = {
  apply(tx: FinanceWipeTx, input: FinanceWipeBranchInput): Promise<number>;
  count(prisma: PrismaService, userId: string): Promise<number>;
};

export type FinanceWipeBranches = Record<string, FinanceWipeBranch>;
