import { Injectable } from '@nestjs/common';
import type { CursorPoint } from '@personal-os/core';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';

export type MerchantPage = {
  cursor: CursorPoint | null;
  take: number;
  search?: string;
};

export type MerchantSpend = {
  merchantId: string;
  spend: number;
  movements: number;
};

@Injectable()
export class MerchantsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listMerchants(userId: string, page: MerchantPage) {
    const search = page.search?.trim();
    const conditions: Prisma.FinMerchantWhereInput[] = [];
    if (search) {
      conditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { normalizedKey: { contains: search.toUpperCase() } },
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
    return this.prisma.finMerchant.findMany({
      where: conditions.length > 0 ? { userId, AND: conditions } : { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.take,
    });
  }

  findMerchantById(userId: string, id: string) {
    return this.prisma.finMerchant.findFirst({ where: { id, userId } });
  }

  findMerchantByKey(userId: string, normalizedKey: string) {
    return this.prisma.finMerchant.findFirst({
      where: { userId, normalizedKey },
    });
  }

  findMerchantByKeyPrefix(userId: string, normalizedKey: string) {
    return this.prisma.finMerchant.findFirst({
      where: { userId, normalizedKey: { startsWith: normalizedKey } },
      orderBy: { createdAt: 'asc' },
    });
  }

  createMerchant(
    userId: string,
    data: { name: string; normalizedKey: string; rawAlias: string | null },
  ) {
    return this.prisma.finMerchant.create({
      data: {
        userId,
        name: data.name,
        normalizedKey: data.normalizedKey,
        aliases: data.rawAlias ? [data.rawAlias] : [],
      },
    });
  }

  updateMerchant(
    userId: string,
    id: string,
    data: {
      name?: string;
      normalizedKey?: string;
      categoryId?: string | null;
      logoUrl?: string | null;
      aliases?: string[];
    },
  ) {
    return this.prisma.finMerchant.updateMany({
      where: { id, userId },
      data,
    });
  }

  sumSpendByMerchant(
    userId: string,
    merchantIds: string[],
    range: { from: Date; to: Date },
  ): Promise<MerchantSpend[]> {
    if (merchantIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.prisma.finTransaction
      .groupBy({
        by: ['merchantId'],
        where: {
          userId,
          merchantId: { in: merchantIds },
          type: 'DEBIT',
          status: 'CONFIRMED',
          transactionDate: { gte: range.from, lte: range.to },
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
                  spend: Number(row._sum.amountBaseCurrency ?? 0),
                  movements: row._count._all,
                },
              ]
            : [],
        ),
      );
  }

  async mergeMerchants(userId: string, sourceId: string, targetId: string) {
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.finMerchant.findFirst({
        where: { id: sourceId, userId },
      });
      const target = await tx.finMerchant.findFirst({
        where: { id: targetId, userId },
      });
      if (!source || !target) {
        return null;
      }
      const aliases = [...new Set([...target.aliases, ...source.aliases])];
      await tx.finTransaction.updateMany({
        where: { userId, merchantId: sourceId },
        data: { merchantId: targetId },
      });
      await tx.finRecurringPattern.updateMany({
        where: { userId, merchantId: sourceId },
        data: { merchantId: targetId },
      });
      const updated = await tx.finMerchant.update({
        where: { id: targetId },
        data: { aliases },
      });
      await tx.finMerchant.delete({ where: { id: sourceId } });
      return updated;
    });
  }
}
