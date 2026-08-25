import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../prisma/generated/client';
import { Prisma as PrismaNS } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../../prisma/prisma.service';

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getAnalyticsSummary(userId: string, from?: Date, to?: Date) {
    const dateFilter =
      from || to
        ? {
            transactionDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {};

    const [accounts, cardBalances, aggregates] = await this.prisma.$transaction([
      this.prisma.finAccount.findMany({ where: { userId, isActive: true } }),
      this.prisma.finCardBalance.findMany({
        where: { card: { userId, isActive: true } },
        include: { card: true },
      }),
      this.prisma.finTransaction.groupBy({
        by: ['type', 'status'],
        where: { userId, ...dateFilter },
        _sum: { amountBaseCurrency: true },
        _count: { _all: true },
        orderBy: { type: 'asc' },
      }),
    ]);

    return { accounts, cardBalances, aggregates };
  }

  async getSpendingByCategory(userId: string, from?: Date, to?: Date) {
    const where: Prisma.FinTransactionWhereInput = {
      userId,
      type: 'DEBIT',
      status: 'CONFIRMED',
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

  async getSpendingOverTime(
    userId: string,
    from: Date | undefined,
    to: Date | undefined,
    granularity: 'day' | 'week' | 'month',
  ) {
    const trunc =
      granularity === 'month' ? 'month' : granularity === 'week' ? 'week' : 'day';

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
