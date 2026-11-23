import { Injectable } from '@nestjs/common';
import { Prisma, PrismaService } from '@personal-os/database';
import type { FinMerchantCategorySource } from '@personal-os/database';
import { normalizeMerchant } from '../domain/normalize-merchant';
import { mergeMerchantsInTransaction } from './merchant-merge';
import {
  MERCHANT_INCLUDE,
  merchantListConditions,
  sumMerchantSpend,
  type MerchantPage,
  type MerchantSpend,
} from './merchant-queries';

export type { MerchantPage, MerchantSpend } from './merchant-queries';

export type MerchantAliasInput = {
  userId: string;
  merchantId: string;
  alias: string;
  normalizedKey: string;
};

@Injectable()
export class MerchantsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listMerchants(userId: string, page: MerchantPage) {
    const conditions = merchantListConditions(page);
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
      domain?: string | null;
      logoPath?: string | null;
    },
  ) {
    return this.prisma.finMerchant.create({
      data: {
        userId,
        name: data.name,
        normalizedKey: data.normalizedKey,
        categoryId: data.categoryId ?? null,
        categorySource: data.categorySource ?? null,
        domain: data.domain ?? null,
        logoPath: data.logoPath ?? null,
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
      domain?: string | null;
      logoPath?: string | null;
      customLogoPath?: string | null;
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
  async addAlias(input: MerchantAliasInput): Promise<void> {
    try {
      await this.prisma.finMerchantAlias.create({ data: input });
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
    merchantIds: readonly string[],
    range: { from: Date; to: Date },
  ): Promise<MerchantSpend[]> {
    return sumMerchantSpend(this.prisma, { userId, merchantIds, range });
  }

  mergeMerchants(userId: string, sourceId: string, targetId: string) {
    return mergeMerchantsInTransaction(this.prisma, {
      userId,
      sourceId,
      targetId,
    });
  }
}
