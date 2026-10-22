import { Injectable } from '@nestjs/common';
import { clampPageLimit, decodeCursor } from '@personal-os/core';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import { EMAIL_DUPLICATE_DATE_TOLERANCE_MS } from '../../shared/domain/email-dedupe';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import { OPERATION_LEG_ROLE } from '../../shared/domain/transfer';
import {
  TRANSACTION_LINK_KIND,
  type TransactionLinkKind,
} from '../../shared/domain/transaction-links';
import type {
  FinTxStatus,
  ListTransactionsQuery,
} from '../application/commands/ledger.commands';
import type {
  BalanceAdjustmentTarget,
  LedgerTransactionRow,
} from '../application/ports/ledger.repository.port';
import { logicalTransactionsWhere } from './logical-transaction-query';

const transactionPartyInclude = {
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
const transactionLinkInclude = {
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

@Injectable()
export class PrismaLedgerReadRepository {
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

  findAccountById(id: string, userId: string) {
    return this.prisma.finAccount.findFirst({
      where: { id, userId },
      select: { id: true, currency: true },
    });
  }

  async findCardLedgerContext(id: string, userId: string) {
    const card = await this.prisma.finCard.findFirst({
      where: { id, userId },
      select: {
        type: true,
        accountId: true,
        balances: { select: { currency: true } },
      },
    });
    if (!card) {
      return null;
    }
    return {
      cardType: card.type,
      accountId: card.accountId,
      currencies: card.balances.map((balance) => balance.currency),
    };
  }

  async findSavingsGoalIdByAccount(
    userId: string,
    accountId: string,
  ): Promise<string | null> {
    const goal = await this.prisma.finSavingsGoal.findFirst({
      where: { userId, accountId },
      select: { id: true },
    });
    return goal?.id ?? null;
  }

  async findBalanceAdjustmentTarget(
    userId: string,
    input: { accountId?: string; cardId?: string; currency?: string },
  ): Promise<BalanceAdjustmentTarget | null> {
    const hasAccount = Boolean(input.accountId);
    const hasCard = Boolean(input.cardId);
    if (hasAccount === hasCard) {
      return null;
    }

    if (input.accountId) {
      const account = await this.prisma.finAccount.findFirst({
        where: { id: input.accountId, userId },
        select: { id: true, currency: true, balance: true },
      });
      if (!account) {
        return null;
      }
      return {
        accountId: account.id,
        cardId: null,
        currency: account.currency,
        currentBalance: Number(account.balance),
      };
    }

    if (!input.cardId || !input.currency) {
      return null;
    }

    const card = await this.prisma.finCard.findFirst({
      where: { id: input.cardId, userId },
      select: { id: true, type: true, accountId: true },
    });
    if (!card) {
      return null;
    }
    if (card.type === 'DEBIT' && !card.accountId) {
      return null;
    }
    if (card.type === 'CREDIT' && card.accountId) {
      return null;
    }

    const currency = normalizeCurrencyCode(input.currency);
    const balanceRow = await this.prisma.finCardBalance.findFirst({
      where: { cardId: card.id, currency },
      select: { balance: true },
    });
    return {
      accountId: null,
      cardId: card.id,
      currency,
      currentBalance: balanceRow ? Number(balanceRow.balance) : 0,
    };
  }

  findTransactionByEmailMessageId(gmailMessageId: string, userId?: string) {
    return this.prisma.finTransaction.findFirst({
      where: {
        emailMessage: { gmailMessageId },
        ...(userId ? { userId } : {}),
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

  findCandidatesForReverse(
    userId: string,
    params: {
      amount: number;
      currency: string;
      merchant: string | null;
      aroundDate: Date;
      statuses?: FinTxStatus[];
    },
  ) {
    const from = new Date(params.aroundDate);
    from.setUTCDate(from.getUTCDate() - 14);
    const to = new Date(params.aroundDate);
    to.setUTCDate(to.getUTCDate() + 14);
    return this.prisma.finTransaction.findMany({
      where: {
        userId,
        status: { in: params.statuses ?? ['CONFIRMED'] },
        currency: params.currency,
        amount: params.amount,
        transactionDate: { gte: from, lte: to },
        ...(params.merchant
          ? { merchant: { contains: params.merchant, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { transactionDate: 'desc' },
      take: 10,
    }) as Promise<LedgerTransactionRow[]>;
  }

  findTransactionByExternalReference(userId: string, reference: string) {
    return this.prisma.finTransaction.findFirst({
      where: { userId, externalReference: reference },
      orderBy: { transactionDate: 'desc' },
    }) as Promise<LedgerTransactionRow | null>;
  }

  /** Same target, currency and exact amount within 48 h, with no bank reference. */
  findPossibleDuplicate(
    userId: string,
    params: {
      accountId?: string | null;
      cardId?: string | null;
      amount: number;
      currency: string;
      type: 'DEBIT' | 'CREDIT';
      transactionDate: Date;
    },
  ) {
    const windowMs = 48 * 60 * 60 * 1000;
    return this.prisma.finTransaction.findFirst({
      where: {
        userId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        externalReference: null,
        currency: params.currency,
        amount: params.amount,
        type: params.type,
        transactionDate: {
          gte: new Date(params.transactionDate.getTime() - windowMs),
          lte: new Date(params.transactionDate.getTime() + windowMs),
        },
        ...(params.accountId ? { accountId: params.accountId } : {}),
        ...(params.cardId ? { cardId: params.cardId } : {}),
      },
      orderBy: { transactionDate: 'desc' },
    }) as Promise<LedgerTransactionRow | null>;
  }

  findDedupeCandidate(
    userId: string,
    params: {
      externalReference: string | null;
      accountId?: string | null;
      cardId?: string | null;
      amount: number;
      currency: string;
      type: 'DEBIT' | 'CREDIT';
      merchant: string | null;
      transactionDate: Date;
    },
  ) {
    if (params.externalReference) {
      return this.prisma.finTransaction.findFirst({
        where: {
          userId,
          externalReference: params.externalReference,
          status: { in: ['PENDING', 'CONFIRMED'] },
        },
        orderBy: { transactionDate: 'desc' },
      }) as Promise<LedgerTransactionRow | null>;
    }
    const tolerance = EMAIL_DUPLICATE_DATE_TOLERANCE_MS;
    const from = new Date(params.transactionDate.getTime() - tolerance);
    const to = new Date(params.transactionDate.getTime() + tolerance);
    return this.prisma.finTransaction.findFirst({
      where: {
        userId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        currency: params.currency,
        amount: params.amount,
        type: params.type,
        transactionDate: { gte: from, lte: to },
        ...(params.accountId ? { accountId: params.accountId } : {}),
        ...(params.cardId ? { cardId: params.cardId } : {}),
        ...(params.merchant
          ? { merchant: { equals: params.merchant, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { transactionDate: 'desc' },
    }) as Promise<LedgerTransactionRow | null>;
  }

  async findLatestCategoryIdByMerchant(userId: string, merchant: string) {
    const trimmed = merchant.trim();
    if (!trimmed) {
      return null;
    }
    const row = await this.prisma.finTransaction.findFirst({
      where: {
        userId,
        status: 'CONFIRMED',
        categoryId: { not: null },
        merchant: { equals: trimmed, mode: 'insensitive' },
      },
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      select: { categoryId: true },
    });
    return row?.categoryId ?? null;
  }
}
