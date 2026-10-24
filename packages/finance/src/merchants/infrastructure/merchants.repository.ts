import { Injectable } from '@nestjs/common';
import type { CursorPoint } from '@personal-os/core';
import { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import type { FinMerchantCategorySource } from '@personal-os/database';
import { aliasNormalizedKey } from '../domain/merchant-aliases';
import { normalizeMerchant } from '../domain/normalize-merchant';
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

const MERCHANT_INCLUDE = {
  aliases: { select: { alias: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.FinMerchantInclude;

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
    return this.prisma.finMerchant.findMany({
      where: conditions.length > 0 ? { userId, AND: conditions } : { userId },
      include: MERCHANT_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.take,
    });
  }

  findMerchantById(userId: string, id: string) {
    return this.prisma.finMerchant.findFirst({
      where: { id, userId },
      include: MERCHANT_INCLUDE,
    });
  }

  /** Name, key and alias of every merchant, for the duplicate detection. */
  listMerchantComparables(userId: string) {
    return this.prisma.finMerchant.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        normalizedKey: true,
        logoUrl: true,
        aliases: { select: { alias: true } },
      },
    });
  }

  findMerchantsByIds(userId: string, ids: readonly string[]) {
    return this.prisma.finMerchant.findMany({
      where: { id: { in: [...ids] }, userId },
      include: MERCHANT_INCLUDE,
    });
  }

  findMerchantByKey(userId: string, normalizedKey: string) {
    return this.prisma.finMerchant.findFirst({
      where: { userId, normalizedKey },
      include: MERCHANT_INCLUDE,
    });
  }

  /** Merchant that already claims this text as an alias. */
  findMerchantByAliasKey(userId: string, normalizedKey: string) {
    return this.prisma.finMerchant.findFirst({
      where: { userId, aliases: { some: { normalizedKey } } },
      include: MERCHANT_INCLUDE,
    });
  }

  findMerchantByKeyPrefix(userId: string, normalizedKey: string) {
    return this.prisma.finMerchant.findFirst({
      where: { userId, normalizedKey: { startsWith: normalizedKey } },
      include: MERCHANT_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Merchant holding any of these alias keys, for the 409 of an edit. */
  findMerchantByAliasKeys(userId: string, normalizedKeys: readonly string[]) {
    if (normalizedKeys.length === 0) {
      return Promise.resolve(null);
    }
    return this.prisma.finMerchant.findFirst({
      where: {
        userId,
        aliases: { some: { normalizedKey: { in: [...normalizedKeys] } } },
      },
      include: MERCHANT_INCLUDE,
    });
  }

  /** Merchant whose own key matches any of these alias keys. */
  findMerchantByKeys(userId: string, normalizedKeys: readonly string[]) {
    if (normalizedKeys.length === 0) {
      return Promise.resolve(null);
    }
    return this.prisma.finMerchant.findFirst({
      where: { userId, normalizedKey: { in: [...normalizedKeys] } },
      include: MERCHANT_INCLUDE,
    });
  }

  createMerchant(
    userId: string,
    data: {
      name: string;
      normalizedKey: string;
      aliases: string[];
      categoryId?: string | null;
      categorySource?: FinMerchantCategorySource | null;
    },
  ) {
    return this.prisma.finMerchant.create({
      data: {
        userId,
        name: data.name,
        normalizedKey: data.normalizedKey,
        categoryId: data.categoryId ?? null,
        categorySource: data.categorySource ?? null,
        aliases: {
          create: data.aliases.flatMap((alias) => {
            const normalizedKey = normalizeMerchant(alias);
            return normalizedKey ? [{ userId, alias, normalizedKey }] : [];
          }),
        },
      },
      include: MERCHANT_INCLUDE,
    });
  }

  /** Categories the user can see, for the keyword guess. */
  listVisibleCategories(userId: string) {
    return this.prisma.finCategory.findMany({
      where: { OR: [{ userId }, { isSystem: true }] },
      select: { id: true, name: true, type: true },
    });
  }

  updateMerchant(
    userId: string,
    id: string,
    data: {
      name?: string;
      normalizedKey?: string;
      categoryId?: string | null;
      categorySource?: FinMerchantCategorySource | null;
      logoUrl?: string | null;
    },
  ) {
    return this.prisma.finMerchant.updateMany({
      where: { id, userId },
      data,
    });
  }

  /** Replaces the whole alias list of a merchant. */
  async replaceAliases(
    userId: string,
    merchantId: string,
    aliases: readonly string[],
  ) {
    const rows = aliases.flatMap((alias) => {
      const normalizedKey = normalizeMerchant(alias);
      return normalizedKey
        ? [{ userId, merchantId, alias, normalizedKey }]
        : [];
    });
    await this.prisma.$transaction([
      this.prisma.finMerchantAlias.deleteMany({ where: { merchantId } }),
      this.prisma.finMerchantAlias.createMany({ data: rows }),
    ]);
  }

  /**
   * Adds one alias without throwing when another merchant already holds it:
   * the resolver still returns the merchant it matched by key.
   */
  async addAlias(
    userId: string,
    merchantId: string,
    alias: string,
    normalizedKey: string,
  ): Promise<void> {
    try {
      await this.prisma.finMerchantAlias.create({
        data: { userId, merchantId, alias, normalizedKey },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      throw error;
    }
  }

  /** Dismissed pairs of the user, as canonical pairs of merchant ids. */
  listDismissedPairs(userId: string) {
    return this.prisma.finMerchantDuplicateDismissal.findMany({
      where: { userId },
      select: { merchantId: true, otherMerchantId: true },
    });
  }

  dismissPair(userId: string, merchantId: string, otherMerchantId: string) {
    return this.prisma.finMerchantDuplicateDismissal.upsert({
      where: {
        userId_merchantId_otherMerchantId: {
          userId,
          merchantId,
          otherMerchantId,
        },
      },
      create: { userId, merchantId, otherMerchantId },
      update: {},
    });
  }

  async undoDismissPair(
    userId: string,
    merchantId: string,
    otherMerchantId: string,
  ): Promise<void> {
    await this.prisma.finMerchantDuplicateDismissal.deleteMany({
      where: { userId, merchantId, otherMerchantId },
    });
  }

  /**
   * A dismissed pair follows the merchant that survives a merge, except the
   * pair between both of them.
   */
  private async moveDismissals(
    tx: Prisma.TransactionClient,
    userId: string,
    sourceId: string,
    targetId: string,
  ): Promise<void> {
    const rows = await tx.finMerchantDuplicateDismissal.findMany({
      where: {
        userId,
        OR: [{ merchantId: sourceId }, { otherMerchantId: sourceId }],
        NOT: {
          OR: [{ merchantId: targetId }, { otherMerchantId: targetId }],
        },
      },
    });
    await tx.finMerchantDuplicateDismissal.deleteMany({
      where: {
        id: { in: rows.map((row) => row.id) },
      },
    });
    if (rows.length === 0) {
      return;
    }
    const moved = rows.map((row) => {
      const partner =
        row.merchantId === sourceId ? row.otherMerchantId : row.merchantId;
      const [merchantId, otherMerchantId] =
        targetId < partner ? [targetId, partner] : [partner, targetId];
      return { userId, merchantId, otherMerchantId };
    });
    await tx.finMerchantDuplicateDismissal.createMany({
      data: moved,
      skipDuplicates: true,
    });
  }

  listAliasKeys(merchantId: string): Promise<Array<{ normalizedKey: string }>> {
    return this.prisma.finMerchantAlias.findMany({
      where: { merchantId },
      select: { normalizedKey: true },
    });
  }

  countAliases(merchantId: string) {
    return this.prisma.finMerchantAlias.count({ where: { merchantId } });
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
                  spend: toMoney(row._sum.amountBaseCurrency ?? 0),
                  movements: row._count._all,
                },
              ]
            : [],
        ),
      );
  }

  /**
   * Moves everything the source taught to the target: its own name and key and
   * its aliases become aliases, and the target inherits the category and logo it
   * does not have. The source is removed.
   */
  async mergeMerchants(userId: string, sourceId: string, targetId: string) {
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.finMerchant.findFirst({
        where: { id: sourceId, userId },
        include: MERCHANT_INCLUDE,
      });
      const target = await tx.finMerchant.findFirst({
        where: { id: targetId, userId },
        include: MERCHANT_INCLUDE,
      });
      if (!source || !target) {
        return null;
      }
      const learnedAliases = [
        source.name,
        ...source.aliases.map((entry) => entry.alias),
      ];
      await tx.finTransaction.updateMany({
        where: { userId, merchantId: sourceId },
        data: { merchantId: targetId },
      });
      await tx.finRecurringPattern.updateMany({
        where: { userId, merchantId: sourceId },
        data: { merchantId: targetId },
      });
      await this.moveDismissals(tx, userId, sourceId, targetId);
      await tx.finMerchant.delete({ where: { id: sourceId } });
      const existing = new Set(
        target.aliases.map((entry) => aliasNormalizedKey(entry.alias)),
      );
      const newAliases = learnedAliases.flatMap((alias) => {
        const key = aliasNormalizedKey(alias);
        if (!key || existing.has(key) || key === target.normalizedKey) {
          return [];
        }
        existing.add(key);
        return [{ userId, merchantId: targetId, alias, normalizedKey: key }];
      });
      if (newAliases.length > 0) {
        await tx.finMerchantAlias.createMany({
          data: newAliases,
          skipDuplicates: true,
        });
      }
      await tx.finMerchant.update({
        where: { id: targetId },
        data: {
          ...(target.categoryId ? {} : { categoryId: source.categoryId }),
          ...(target.categoryId || !source.categoryId
            ? {}
            : { categorySource: source.categorySource }),
          ...(target.logoUrl ? {} : { logoUrl: source.logoUrl }),
        },
      });
      return tx.finMerchant.findFirst({
        where: { id: targetId },
        include: MERCHANT_INCLUDE,
      });
    });
  }
}
