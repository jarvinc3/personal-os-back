import { PrismaService } from '@personal-os/database';
import { IMPORT_DUPLICATE_DATE_TOLERANCE_MS } from '../../shared/domain/import-dedupe';
import type { FinTxStatus } from '../application/commands/ledger.commands';
import type { LedgerTransactionRow } from '../application/ports/ledger.repository.port';

/** Candidatos de reverso y de duplicado, y el último comercio con categoría. */
export class PrismaLedgerCandidateReadRepository {
  constructor(private readonly prisma: PrismaService) {}

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
        type: 'DEBIT',
        transferGroupId: null,
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

  findReverseCandidatesByCard(
    userId: string,
    params: {
      amount: number;
      currency: string;
      cardId: string;
      accountId: string | null;
      from: Date;
      to: Date;
      statuses?: FinTxStatus[];
    },
  ) {
    return this.prisma.finTransaction.findMany({
      where: {
        userId,
        status: { in: params.statuses ?? ['CONFIRMED'] },
        type: 'DEBIT',
        transferGroupId: null,
        currency: params.currency,
        amount: params.amount,
        cardId: params.cardId,
        ...(params.accountId
          ? { OR: [{ accountId: null }, { accountId: params.accountId }] }
          : { accountId: null }),
        transactionDate: { gte: params.from, lte: params.to },
      },
      orderBy: { transactionDate: 'desc' },
      take: 10,
    }) as Promise<LedgerTransactionRow[]>;
  }

  /** The movement imported from that email; reversal rows are not originals. */
  findImportedTransactionByEmailMessageId(userId: string, messageId: string) {
    return this.prisma.finSignalImport
      .findFirst({
        where: {
          userId,
          sourceEmailMessageId: messageId,
          status: 'IMPORTED',
          transactionId: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        include: { transaction: true },
      })
      .then(
        (row) => row?.transaction ?? null,
      ) as Promise<LedgerTransactionRow | null>;
  }

  findLinkedRefundTotal({
    userId,
    originalId,
    currency,
  }: {
    userId: string;
    originalId: string;
    currency: string;
  }) {
    return this.prisma.finTransaction
      .aggregate({
        where: {
          userId,
          linkedTransactionId: originalId,
          type: 'CREDIT',
          currency,
        },
        _sum: { amount: true },
      })
      .then((refundTotals) => Number(refundTotals._sum.amount ?? 0));
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
    const tolerance = IMPORT_DUPLICATE_DATE_TOLERANCE_MS;
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
