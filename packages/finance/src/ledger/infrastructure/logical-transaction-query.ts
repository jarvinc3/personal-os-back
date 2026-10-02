import type { Prisma } from '@personal-os/database';
import type { ListTransactionsQuery } from '../application/commands/ledger.commands';

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

  if (query.type === 'TRANSFER') {
    and.push({ transferGroupId: { not: null }, type: 'DEBIT' });
  } else if (query.type === 'DEBIT' || query.type === 'CREDIT') {
    and.push({ type: query.type, transferGroupId: null });
  } else {
    and.push({
      OR: [
        { transferGroupId: null },
        { transferGroupId: { not: null }, type: 'DEBIT' },
      ],
    });
  }

  if (query.accountId || query.cardId) {
    const instrument: Prisma.FinTransactionWhereInput = {
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.cardId ? { cardId: query.cardId } : {}),
    };
    if (query.type === 'DEBIT' || query.type === 'CREDIT') {
      and.push(instrument);
    } else {
      const or: Prisma.FinTransactionWhereInput[] = [
        { transferGroupId: null, ...instrument },
      ];
      if (matchingGroupIds.length > 0) {
        or.push({
          transferGroupId: { in: matchingGroupIds },
          type: 'DEBIT',
        });
      }
      and.push({ OR: or });
    }
  }

  return { userId, AND: and };
}
