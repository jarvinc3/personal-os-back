import { Injectable } from '@nestjs/common';
import type { CursorPoint } from '@personal-os/core';
import { PrismaService } from '@personal-os/database';

export type InstrumentTarget = { accountId?: string; cardId?: string };

export type InstrumentHistoryPage = {
  cursor: CursorPoint | null;
  take: number;
};

/** History of an account or a card: instrument events and adjustments. */
@Injectable()
export class CatalogInstrumentHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  findInstrumentEvents(
    userId: string,
    target: InstrumentTarget,
    page: InstrumentHistoryPage,
  ) {
    return this.prisma.finInstrumentEvent.findMany({
      where: {
        userId,
        ...(target.accountId ? { accountId: target.accountId } : {}),
        ...(target.cardId ? { cardId: target.cardId } : {}),
        ...(page.cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(page.cursor.key) } },
                {
                  createdAt: new Date(page.cursor.key),
                  id: { lt: page.cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.take,
    });
  }

  findAdjustmentTransactions(
    userId: string,
    target: InstrumentTarget,
    page: InstrumentHistoryPage,
  ) {
    return this.prisma.finTransaction.findMany({
      where: {
        userId,
        type: 'ADJUSTMENT',
        ...(target.accountId ? { accountId: target.accountId } : {}),
        ...(target.cardId ? { cardId: target.cardId } : {}),
        ...(page.cursor
          ? {
              OR: [
                { transactionDate: { lt: new Date(page.cursor.key) } },
                {
                  transactionDate: new Date(page.cursor.key),
                  id: { lt: page.cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
      take: page.take,
    });
  }
}
