import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import type { $Enums, Prisma } from '@personal-os/database';
import type { LedgerMovementInput } from '../domain/statement-line-matching';

export type StatementImportRow = Prisma.FinStatementImportGetPayload<{
  include: { lines: true };
}>;

export type StatementImportContext = Prisma.FinStatementImportGetPayload<{
  include: {
    lines: true;
    card: {
      select: {
        id: true;
        name: true;
        balances: { select: { currency: true } };
      };
    };
    account: { select: { id: true; name: true; currency: true } };
  };
}>;

export type StatementImportLineDraft = {
  date: Date;
  description: string;
  amount: number;
  currency: string;
  type: $Enums.FinStatementLineType;
  reference: string | null;
  categoryId: string | null;
  transactionId: string | null;
  decision: $Enums.FinStatementLineDecision;
};

export type StatementImportCategory = {
  id: string;
  name: string;
  type: $Enums.FinCategoryType;
};

export type StatementTargetBalance = {
  currency: string;
  currentBalance: number;
  creditLimit: number | null;
};

const IMPORT_CONTEXT_INCLUDE = {
  lines: { orderBy: [{ date: 'asc' as const }, { id: 'asc' as const }] },
  card: {
    select: {
      id: true,
      name: true,
      balances: { select: { currency: true } },
    },
  },
  account: { select: { id: true, name: true, currency: true } },
} satisfies Prisma.FinStatementImportInclude;

const MOVEMENT_STATUSES: $Enums.FinTransactionStatus[] = [
  'PENDING',
  'CONFIRMED',
];

@Injectable()
export class StatementImportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createImport(input: {
    userId: string;
    cardId: string | null;
    accountId: string | null;
  }) {
    return this.prisma.finStatementImport.create({
      data: {
        userId: input.userId,
        cardId: input.cardId,
        accountId: input.accountId,
      },
    });
  }

  findImportContext(
    userId: string,
    importId: string,
  ): Promise<StatementImportContext | null> {
    return this.prisma.finStatementImport.findFirst({
      where: { id: importId, userId },
      include: IMPORT_CONTEXT_INCLUDE,
    });
  }

  async updateResult(input: {
    importId: string;
    status: $Enums.FinStatementImportStatus;
    parsed?: Prisma.InputJsonValue;
    error?: string | null;
  }): Promise<void> {
    await this.prisma.finStatementImport.update({
      where: { id: input.importId },
      data: {
        status: input.status,
        ...(input.parsed === undefined ? {} : { parsed: input.parsed }),
        ...(input.error === undefined ? {} : { error: input.error }),
      },
    });
  }

  async replaceLines(
    importId: string,
    lines: readonly StatementImportLineDraft[],
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.finStatementImportLine.deleteMany({ where: { importId } }),
      this.prisma.finStatementImportLine.createMany({
        data: lines.map((line) => ({ ...line, importId })),
      }),
    ]);
  }

  async updateLine(input: {
    importId: string;
    lineId: string;
    decision: $Enums.FinStatementLineDecision;
    transactionId?: string | null;
  }): Promise<number> {
    const updated = await this.prisma.finStatementImportLine.updateMany({
      where: { id: input.lineId, importId: input.importId },
      data: {
        decision: input.decision,
        ...(input.transactionId === undefined
          ? {}
          : { transactionId: input.transactionId }),
      },
    });
    return updated.count;
  }

  async linkLineTransaction(
    lineId: string,
    transactionId: string,
  ): Promise<void> {
    await this.prisma.finStatementImportLine.update({
      where: { id: lineId },
      data: { transactionId },
    });
  }

  async markApplied(input: {
    importId: string;
    statementId: string | null;
  }): Promise<void> {
    await this.prisma.finStatementImport.update({
      where: { id: input.importId },
      data: {
        status: 'APPLIED',
        appliedAt: new Date(),
        ...(input.statementId === null
          ? {}
          : { statementId: input.statementId }),
      },
    });
  }

  async deleteImport(importId: string): Promise<void> {
    await this.prisma.finStatementImport.delete({ where: { id: importId } });
  }

  async findMovementsForMatching(input: {
    userId: string;
    cardId: string | null;
    accountId: string | null;
    from: Date;
    to: Date;
  }): Promise<LedgerMovementInput[]> {
    const rows = await this.prisma.finTransaction.findMany({
      where: {
        userId: input.userId,
        status: { in: MOVEMENT_STATUSES },
        transactionDate: { gte: input.from, lte: input.to },
        ...(input.cardId
          ? { cardId: input.cardId }
          : { accountId: input.accountId }),
      },
      select: {
        id: true,
        transactionDate: true,
        description: true,
        merchant: true,
        amount: true,
        currency: true,
        type: true,
        legRole: true,
        externalReference: true,
      },
      orderBy: { transactionDate: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      transactionDate: row.transactionDate,
      description: row.description,
      merchant: row.merchant,
      amount: Number(row.amount),
      currency: row.currency,
      type: row.type,
      legRole: row.legRole,
      externalReference: row.externalReference,
    }));
  }

  async listCategories(userId: string): Promise<StatementImportCategory[]> {
    return this.prisma.finCategory.findMany({
      where: { OR: [{ userId }, { isSystem: true }] },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });
  }

  async findTargetBalance(input: {
    userId: string;
    cardId: string | null;
    accountId: string | null;
    currency: string;
  }): Promise<StatementTargetBalance | null> {
    if (input.accountId) {
      const account = await this.prisma.finAccount.findFirst({
        where: { id: input.accountId, userId: input.userId },
        select: { currency: true, balance: true },
      });
      if (!account) {
        return null;
      }
      return {
        currency: account.currency,
        currentBalance: Number(account.balance),
        creditLimit: null,
      };
    }
    if (!input.cardId) {
      return null;
    }
    const balanceRow = await this.prisma.finCardBalance.findFirst({
      where: { cardId: input.cardId, currency: input.currency },
      select: { balance: true, creditLimit: true },
    });
    if (!balanceRow) {
      return null;
    }
    return {
      currency: input.currency,
      currentBalance: Number(balanceRow.balance),
      creditLimit:
        balanceRow.creditLimit === null ? null : Number(balanceRow.creditLimit),
    };
  }
}
