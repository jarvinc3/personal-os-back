import type { Prisma } from '@personal-os/database';
import type { ListTransactionsQuery } from '../application/commands/ledger.commands';

/**
 * The list shows one row per operation: the SOURCE leg. The destination and the
 * fee travel inside the operation (or the counterpart lookup).
 */
const SOURCE_TRANSFER_LEG: Prisma.FinTransactionWhereInput = {
  transferGroupId: { not: null },
  type: 'DEBIT',
  OR: [{ legRole: null }, { legRole: 'SOURCE' }],
};

export function logicalTransactionsWhere(
  userId: string,
  query: ListTransactionsQuery,
  matchingGroupIds: string[] = [],
): Prisma.FinTransactionWhereInput {
  const and: Prisma.FinTransactionWhereInput[] = [];

  if (query.transferGroupId) {
    and.push({ transferGroupId: query.transferGroupId });
  }
  if (query.categoryId) {
    and.push({ categoryId: query.categoryId });
  }
  if (query.categoryIds && query.categoryIds.length > 0) {
    and.push({ categoryId: { in: query.categoryIds } });
  }
  if (query.status) {
    and.push({ status: query.status });
  }
  if (query.dateFrom || query.dateTo) {
    and.push({
      transactionDate: {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      },
    });
  }
  if (query.search) {
    and.push({
      OR: [
        { merchant: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ],
    });
  }

  if (query.possibleDuplicates) {
    and.push({ possibleDuplicateOfId: { not: null } });
  }

  if (query.type === 'TRANSFER') {
    and.push(SOURCE_TRANSFER_LEG);
  } else if (query.type === 'DEBIT' || query.type === 'CREDIT') {
    and.push({ type: query.type, transferGroupId: null });
  } else if (query.type === 'ADJUSTMENT') {
    and.push({ type: 'ADJUSTMENT' });
  } else {
    and.push({
      OR: [{ transferGroupId: null }, SOURCE_TRANSFER_LEG],
    });
    if (!query.includeAdjustments) {
      and.push({ type: { not: 'ADJUSTMENT' } });
    }
  }

  if (query.accountId || query.cardId) {
    const instrument: Prisma.FinTransactionWhereInput = {
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.cardId ? { cardId: query.cardId } : {}),
    };
    if (
      query.type === 'DEBIT' ||
      query.type === 'CREDIT' ||
      query.type === 'ADJUSTMENT'
    ) {
      and.push(instrument);
    } else {
      const or: Prisma.FinTransactionWhereInput[] = [
        { transferGroupId: null, ...instrument },
      ];
      if (matchingGroupIds.length > 0) {
        or.push({
          ...SOURCE_TRANSFER_LEG,
          transferGroupId: { in: matchingGroupIds },
        });
      }
      and.push({ OR: or });
    }
  }

  return { userId, AND: and };
}
