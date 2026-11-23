import type { CursorPoint } from '@personal-os/core';
import type { Prisma } from '@personal-os/database';
import type { PrismaService } from '@personal-os/database';
import { toMoney } from '../../shared/domain/money';

export type MerchantPage = {
  cursor: CursorPoint | null;
  take: number;
  search?: string;
};

export type MerchantSpend = {
  merchantId: string;
  spend: Prisma.Decimal;
  movements: number;
};

export const MERCHANT_INCLUDE = {
  aliases: { select: { alias: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.FinMerchantInclude;

export function merchantListConditions(
  page: MerchantPage,
): Prisma.FinMerchantWhereInput[] {
  const conditions: Prisma.FinMerchantWhereInput[] = [];
  const search = page.search?.trim();
  if (search) {
    conditions.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { normalizedKey: { contains: search.toUpperCase() } },
        {
          aliases: {
            some: { alias: { contains: search, mode: 'insensitive' } },
          },
        },
      ],
    });
  }
  if (page.cursor) {
    conditions.push({
      OR: [
        { createdAt: { lt: new Date(page.cursor.key) } },
        {
          createdAt: new Date(page.cursor.key),
          id: { lt: page.cursor.id },
        },
      ],
    });
  }
  return conditions;
}

export function sumMerchantSpend(
  prisma: PrismaService,
  input: {
    userId: string;
    merchantIds: readonly string[];
    range: { from: Date; to: Date };
  },
): Promise<MerchantSpend[]> {
  if (input.merchantIds.length === 0) {
    return Promise.resolve([]);
  }
  return prisma.finTransaction
    .groupBy({
      by: ['merchantId'],
      where: {
        userId: input.userId,
        merchantId: { in: [...input.merchantIds] },
        type: 'DEBIT',
        status: 'CONFIRMED',
        transactionDate: { gte: input.range.from, lte: input.range.to },
      },
      _sum: { amountBaseCurrency: true },
      _count: { _all: true },
    })
    .then((rows) =>
      rows.flatMap((row) =>
        row.merchantId
          ? [
              {
                merchantId: row.merchantId,
                spend: toMoney(row._sum.amountBaseCurrency ?? 0),
                movements: row._count._all,
              },
            ]
          : [],
      ),
    );
}
