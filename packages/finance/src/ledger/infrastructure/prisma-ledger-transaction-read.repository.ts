import { clampPageLimit, decodeCursor } from '@personal-os/core';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import {
  TRANSACTION_LINK_KIND,
  type TransactionLinkKind,
} from '../../shared/domain/transaction-links';
import { OPERATION_LEG_ROLE } from '../../shared/domain/transfer';
import type { ListTransactionsQuery } from '../application/commands/ledger.commands';
import type { LedgerTransactionRow } from '../application/ports/ledger.repository.port';
import { logicalTransactionsWhere } from './logical-transaction-query';

export const transactionPartyInclude = {
  account: {
    select: {
      id: true,
      name: true,
      institutionRef: {
        select: {
          logoUrl: true,
          logoPath: true,
          customLogoPath: true,
        },
      },
    },
  },
  card: {
    select: {
      id: true,
      name: true,
      network: true,
      institution: {
        select: {
          logoUrl: true,
          logoPath: true,
          customLogoPath: true,
        },
      },
    },
  },
  merchantRef: {
    select: { id: true, name: true, logoUrl: true },
  },
} satisfies Prisma.FinTransactionInclude;

/** Link relations, only for the single-movement read. */
export const transactionLinkInclude = {
  loanInstallment: {
    select: {
      id: true,
      installmentNo: true,
      loan: { select: { lenderName: true } },
    },
  },
  receivablePayment: {
    select: { id: true, receivable: { select: { debtorName: true } } },
  },
  savingsGoalContribution: {
    select: { id: true, goal: { select: { name: true } } },
  },
} satisfies Prisma.FinTransactionInclude;

/** Consultas de movimientos: página, por id, por grupo y por referencia. */
export class PrismaLedgerTransactionReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findTransactions(userId: string, query: ListTransactionsQuery) {
    const limit = clampPageLimit(query.limit);
    const cursorPoint = query.cursor ? decodeCursor(query.cursor) : null;
    const matchingGroupIds = await this.findTransferGroupIdsForInstrument(
      userId,
      query,
    );
    const baseWhere = logicalTransactionsWhere(userId, query, matchingGroupIds);
    const cursorDate = cursorPoint ? new Date(cursorPoint.key) : null;
    const where: Prisma.FinTransactionWhereInput =
      cursorPoint && cursorDate
        ? {
            AND: [
              baseWhere,
              {
                OR: [
                  { transactionDate: { lt: cursorDate } },
                  { transactionDate: cursorDate, id: { lt: cursorPoint.id } },
                ],
              },
            ],
          }
        : baseWhere;
    const items = (await this.prisma.finTransaction.findMany({
      where,
      orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: transactionPartyInclude,
    })) as LedgerTransactionRow[];

    const groupIds = [
      ...new Set(
        items
          .map((item) => item.transferGroupId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const counterparts =
      groupIds.length === 0
        ? []
        : ((await this.prisma.finTransaction.findMany({
            where: {
              userId,
              transferGroupId: { in: groupIds },
              OR: [
                { legRole: OPERATION_LEG_ROLE.DESTINATION },
                { type: 'CREDIT' },
              ],
            },
            include: transactionPartyInclude,
          })) as LedgerTransactionRow[]);
    const creditByGroup = new Map(
      counterparts.map((row) => [row.transferGroupId, row] as const),
    );

    return items.map((item) => ({
      ...item,
      transferCounterpart: item.transferGroupId
        ? (creditByGroup.get(item.transferGroupId) ?? null)
        : null,
    }));
  }

  private async findTransferGroupIdsForInstrument(
    userId: string,
    query: ListTransactionsQuery,
  ): Promise<string[]> {
    if (!query.accountId && !query.cardId) {
      return [];
    }
    if (
      query.type === 'DEBIT' ||
      query.type === 'CREDIT' ||
      query.type === 'ADJUSTMENT'
    ) {
      return [];
    }
    const rows = await this.prisma.finTransaction.findMany({
      where: {
        userId,
        transferGroupId: { not: null },
        ...(query.accountId ? { accountId: query.accountId } : {}),
        ...(query.cardId ? { cardId: query.cardId } : {}),
      },
      select: { transferGroupId: true },
      distinct: ['transferGroupId'],
    });
    return rows
      .map((row) => row.transferGroupId)
      .filter((id): id is string => Boolean(id));
  }

  findTransactionById(id: string, userId: string) {
    return this.prisma.finTransaction.findFirst({
      where: { id, userId },
      include: { ...transactionPartyInclude, ...transactionLinkInclude },
    }) as Promise<LedgerTransactionRow | null>;
  }

  /** One query for many movements, for the bulk entity lookup. */
  findTransactionsByIds(userId: string, ids: readonly string[]) {
    return this.prisma.finTransaction.findMany({
      where: { id: { in: [...ids] }, userId },
      include: { ...transactionPartyInclude, ...transactionLinkInclude },
    }) as Promise<LedgerTransactionRow[]>;
  }

  async findPlanningLinkKind(
    transactionId: string,
    userId: string,
  ): Promise<TransactionLinkKind | null> {
    const [installment, payment, contribution] = await Promise.all([
      this.prisma.finLoanInstallment.findFirst({
        where: { transactionId, loan: { userId } },
        select: { id: true },
      }),
      this.prisma.finReceivablePayment.findFirst({
        where: { transactionId, receivable: { userId } },
        select: { id: true },
      }),
      this.prisma.finSavingsGoalContribution.findFirst({
        where: { transactionId, goal: { userId } },
        select: { id: true },
      }),
    ]);
    if (installment) {
      return TRANSACTION_LINK_KIND.LOAN_INSTALLMENT;
    }
    if (payment) {
      return TRANSACTION_LINK_KIND.RECEIVABLE_PAYMENT;
    }
    if (contribution) {
      return TRANSACTION_LINK_KIND.SAVINGS_CONTRIBUTION;
    }
    return null;
  }

  findTransactionByImportReference(importReference: string, userId: string) {
    return this.prisma.finTransaction.findFirst({
      where: {
        importReference,
        userId,
      },
    }) as Promise<LedgerTransactionRow | null>;
  }

  findTransactionsByTransferGroupId(transferGroupId: string, userId: string) {
    return this.prisma.finTransaction.findMany({
      where: { transferGroupId, userId },
      include: transactionPartyInclude,
      orderBy: { type: 'asc' },
    }) as Promise<LedgerTransactionRow[]>;
  }

  findTransactionsByTransferGroupIds(
    userId: string,
    transferGroupIds: string[],
  ) {
    if (transferGroupIds.length === 0) {
      return Promise.resolve([] as LedgerTransactionRow[]);
    }
    return this.prisma.finTransaction.findMany({
      where: { userId, transferGroupId: { in: transferGroupIds } },
      include: transactionPartyInclude,
      orderBy: [{ transactionDate: 'asc' }, { id: 'asc' }],
    }) as Promise<LedgerTransactionRow[]>;
  }

  findTransactionByExternalReference(userId: string, reference: string) {
    return this.prisma.finTransaction.findFirst({
      where: { userId, externalReference: reference },
      orderBy: { transactionDate: 'desc' },
    }) as Promise<LedgerTransactionRow | null>;
  }

  /** Every movement with that reference; the reference is not unique. */
  findTransactionsByExternalReference(userId: string, reference: string) {
    return this.prisma.finTransaction.findMany({
      where: { userId, externalReference: reference },
      orderBy: { transactionDate: 'desc' },
    }) as Promise<LedgerTransactionRow[]>;
  }
}
