import type { Prisma } from '@personal-os/database';
import type { PrismaService } from '@personal-os/database';
import { aliasNormalizedKey } from '../domain/merchant-aliases';
import { MERCHANT_INCLUDE } from './merchant-queries';

type MergeMerchantsInput = {
  userId: string;
  sourceId: string;
  targetId: string;
};

type MerchantWithAliases = Prisma.FinMerchantGetPayload<{
  include: typeof MERCHANT_INCLUDE;
}>;

/**
 * A dismissed pair follows the merchant that survives a merge, except the
 * pair between both of them.
 */
async function moveDismissals(
  tx: Prisma.TransactionClient,
  input: MergeMerchantsInput,
): Promise<void> {
  const { userId, sourceId, targetId } = input;
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

/**
 * Moves everything the source taught to the target: its own name and key and
 * its aliases become aliases, and the target inherits the category and logo it
 * does not have. The source is removed.
 */
export function mergeMerchantsInTransaction(
  prisma: PrismaService,
  input: MergeMerchantsInput,
): Promise<MerchantWithAliases | null> {
  const { userId, sourceId, targetId } = input;
  return prisma.$transaction(async (tx) => {
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
    await moveDismissals(tx, input);
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
        ...(target.domain ? {} : { domain: source.domain }),
        ...(target.logoPath ? {} : { logoPath: source.logoPath }),
        ...(target.customLogoPath
          ? {}
          : { customLogoPath: source.customLogoPath }),
      },
    });
    return tx.finMerchant.findFirst({
      where: { id: targetId },
      include: MERCHANT_INCLUDE,
    });
  });
}
