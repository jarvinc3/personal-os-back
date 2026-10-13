import { Injectable } from '@nestjs/common';
import type { Prisma } from '@personal-os/database';
import { Prisma as PrismaNS } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import { OPERATION_LEG_ROLE } from '../../shared/domain/transfer';

/** Standalone movements plus the fee leg of a transfer (the only leg that is real spending). */
const REAL_MOVEMENT = {
  OR: [{ transferGroupId: null }, { legRole: OPERATION_LEG_ROLE.FEE }],
} satisfies Prisma.FinTransactionWhereInput;

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getCashFlowAggregates(userId: string, from?: Date, to?: Date) {
    const dateFilter =
      from || to
        ? {
            transactionDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {};

    return this.prisma.finTransaction.groupBy({
      by: ['type', 'status'],
      where: {
        userId,
        ...REAL_MOVEMENT,
        linkedTransactionId: null,
        ...dateFilter,
      },
      _sum: { amountBaseCurrency: true },
      _count: { _all: true },
      orderBy: { type: 'asc' },
    });
  }

  async getSpendingByCategory(userId: string, from?: Date, to?: Date) {
    const where: Prisma.FinTransactionWhereInput = {
      userId,
      type: 'DEBIT',
      status: 'CONFIRMED',
      linkedTransactionId: null,
      ...REAL_MOVEMENT,
      ...(from || to
        ? {
            transactionDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };
    return this.prisma.finTransaction.groupBy({
      by: ['categoryId'],
      where,
      _sum: { amountBaseCurrency: true },
      orderBy: { _sum: { amountBaseCurrency: 'desc' } },
    });
  }

  findCategoriesByIds(userId: string, ids: string[]) {
    const select = { id: true, name: true, color: true, icon: true } as const;
    if (ids.length === 0) {
      return Promise.resolve(
        [] as Prisma.FinCategoryGetPayload<{ select: typeof select }>[],
      );
    }
    return this.prisma.finCategory.findMany({
      where: {
        id: { in: ids },
        OR: [{ userId }, { isSystem: true }],
      },
      select,
    });
  }

  async getSpendingOverTime(
    userId: string,
    from: Date | undefined,
    to: Date | undefined,
    granularity: 'day' | 'week' | 'month',
  ) {
    const trunc =
      granularity === 'month'
        ? 'month'
        : granularity === 'week'
          ? 'week'
          : 'day';

    const rows = await this.prisma.$queryRaw<
      Array<{ bucket: Date; type: string; total: number }>
    >`
      SELECT
        date_trunc(${PrismaNS.raw(`'${trunc}'`)}, "transaction_date") AS bucket,
        "type"::text AS type,
        SUM("amount_base_currency")::float AS total
      FROM "fin_transactions"
      WHERE "user_id" = ${userId}
        AND "status" = 'CONFIRMED'
        AND "type" IN ('DEBIT', 'CREDIT')
        AND "linked_transaction_id" IS NULL
        AND ("transfer_group_id" IS NULL OR "leg_role" = 'FEE')
        ${from ? PrismaNS.sql`AND "transaction_date" >= ${from}` : PrismaNS.empty}
        ${to ? PrismaNS.sql`AND "transaction_date" <= ${to}` : PrismaNS.empty}
      GROUP BY 1, 2
      ORDER BY 1 ASC
    `;

    return rows.map((row) => ({
      bucket: new Date(row.bucket),
      type: row.type,
      total: Number(row.total) || 0,
    }));
  }

  listBudgets(userId: string) {
    return this.prisma.finBudget.findMany({
      where: { userId },
      include: { category: true },
      orderBy: { periodStart: 'desc' },
    });
  }
}
