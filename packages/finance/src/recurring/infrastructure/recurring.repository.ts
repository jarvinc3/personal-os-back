import { Injectable } from '@nestjs/common';
import type { CursorPoint } from '@personal-os/core';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import type {
  FinRecurringKind,
  FinRecurringStatus,
} from '@personal-os/database';

export type DetectionCharge = {
  id: string;
  merchantId: string;
  merchantName: string;
  categoryId: string | null;
  type: 'DEBIT' | 'CREDIT';
  amount: number;
  transactionDate: Date;
};

export type RecurringPatternPage = {
  cursor: CursorPoint | null;
  take: number;
  status?: FinRecurringStatus;
};

@Injectable()
export class RecurringRepository {
  constructor(private readonly prisma: PrismaService) {}

  listCandidateUserIds(since: Date): Promise<string[]> {
    return this.prisma.finTransaction
      .groupBy({
        by: ['userId'],
        where: {
          status: 'CONFIRMED',
          merchantId: { not: null },
          type: { in: ['DEBIT', 'CREDIT'] },
          transactionDate: { gte: since },
        },
      })
      .then((rows) => rows.map((row) => row.userId));
  }

  findChargesForDetection(
    userId: string,
    since: Date,
  ): Promise<DetectionCharge[]> {
    return this.prisma.finTransaction
      .findMany({
        where: {
          userId,
          status: 'CONFIRMED',
          merchantId: { not: null },
          type: { in: ['DEBIT', 'CREDIT'] },
          transactionDate: { gte: since },
        },
        select: {
          id: true,
          merchantId: true,
          categoryId: true,
          type: true,
          amountBaseCurrency: true,
          transactionDate: true,
          merchantRef: { select: { name: true, categoryId: true } },
        },
        orderBy: [{ merchantId: 'asc' }, { transactionDate: 'asc' }],
      })
      .then((rows) =>
        rows.flatMap((row) =>
          row.merchantId
            ? [
                {
                  id: row.id,
                  merchantId: row.merchantId,
                  merchantName: row.merchantRef?.name ?? '',
                  categoryId:
                    row.merchantRef?.categoryId ?? row.categoryId ?? null,
                  type: row.type as 'DEBIT' | 'CREDIT',
                  amount: Number(row.amountBaseCurrency),
                  transactionDate: row.transactionDate,
                },
              ]
            : [],
        ),
      );
  }

  listPatterns(userId: string, page: RecurringPatternPage) {
    return this.prisma.finRecurringPattern.findMany({
      where: {
        userId,
        isActive: true,
        ...(page.status ? { status: page.status } : {}),
        ...(page.cursor
          ? {
              OR: [
                { nextExpectedDate: { gt: new Date(page.cursor.key) } },
                {
                  nextExpectedDate: new Date(page.cursor.key),
                  id: { gt: page.cursor.id },
                },
              ],
            }
          : {}),
      },
      include: { merchantRef: true },
      orderBy: [{ nextExpectedDate: 'asc' }, { id: 'asc' }],
      take: page.take,
    });
  }

  findPatternById(userId: string, id: string) {
    return this.prisma.finRecurringPattern.findFirst({
      where: { id, userId },
      include: { merchantRef: true },
    });
  }

  findPatternByMerchantAndKind(
    userId: string,
    merchantId: string,
    kind: FinRecurringKind,
  ) {
    return this.prisma.finRecurringPattern.findFirst({
      where: { userId, merchantId, kind },
      include: { merchantRef: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  findConfirmedPatterns(userId: string) {
    return this.prisma.finRecurringPattern.findMany({
      where: { userId, isActive: true, status: 'CONFIRMED' },
      include: { merchantRef: true },
      orderBy: { nextExpectedDate: 'asc' },
    });
  }

  createPattern(
    userId: string,
    data: Omit<Prisma.FinRecurringPatternUncheckedCreateInput, 'userId'>,
  ) {
    return this.prisma.finRecurringPattern.create({
      data: { ...data, userId },
      include: { merchantRef: true },
    });
  }

  updatePattern(
    userId: string,
    id: string,
    data: Prisma.FinRecurringPatternUncheckedUpdateInput,
  ) {
    return this.prisma.finRecurringPattern
      .updateMany({ where: { id, userId }, data })
      .then(async (updated) => {
        if (updated.count === 0) {
          return null;
        }
        return this.findPatternById(userId, id);
      });
  }
}
