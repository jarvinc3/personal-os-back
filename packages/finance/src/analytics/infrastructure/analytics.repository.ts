import { Injectable } from '@nestjs/common';
import type { Prisma } from '@personal-os/database';
import { Prisma as PrismaNS } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import { toMoney } from '../../shared/domain/money';
import {
  sumBudgetSpent,
  type BudgetSpentScope,
} from '../../shared/infrastructure/budget-spent.reader';
import { OPERATION_LEG_ROLE } from '../../shared/domain/transfer';

/** Standalone movements plus the fee leg of a transfer (the only leg that is real spending). */
const REAL_MOVEMENT = {
  OR: [{ transferGroupId: null }, { legRole: OPERATION_LEG_ROLE.FEE }],
} satisfies Prisma.FinTransactionWhereInput;

type CashFlowRow = {
  type: string;
  status: string;
  _sum: { amountBaseCurrency: Prisma.Decimal | null };
  _count: { _all: number };
};

type CategorySpendRow = {
  categoryId: string | null;
  _sum: { amountBaseCurrency: Prisma.Decimal | null };
};

type SpendingPointRow = {
  bucket: Date;
  type: string;
  total: Prisma.Decimal;
};

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

    const grouped = await this.prisma.finTransaction.groupBy({
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
    return this.netLinkedRefunds(grouped, userId, from, to);
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
    const grouped = await this.prisma.finTransaction.groupBy({
      by: ['categoryId'],
      where,
      _sum: { amountBaseCurrency: true },
      orderBy: { _sum: { amountBaseCurrency: 'desc' } },
    });
    const refundGroups = await this.prisma.finTransaction.groupBy({
      by: ['categoryId'],
      where: this.linkedRefundWhere(userId, from, to),
      _sum: { amountBaseCurrency: true },
    });
    return this.netSpendingByCategory(grouped, refundGroups);
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
      Array<{ bucket: Date; type: string; total: string }>
    >`
      SELECT
        date_trunc(${PrismaNS.raw(`'${trunc}'`)}, "transaction_date") AS bucket,
        "type"::text AS type,
        SUM("amount_base_currency")::text AS total
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

    const refunds = await this.prisma.$queryRaw<
      Array<{ bucket: Date; total: string }>
    >`
      SELECT
        date_trunc(${PrismaNS.raw(`'${trunc}'`)}, "transaction_date") AS bucket,
        SUM("amount_base_currency")::text AS total
      FROM "fin_transactions"
      WHERE "user_id" = ${userId}
        AND "status" = 'CONFIRMED'
        AND "type" = 'CREDIT'
        AND "linked_transaction_id" IS NOT NULL
        AND "transfer_group_id" IS NULL
        ${from ? PrismaNS.sql`AND "transaction_date" >= ${from}` : PrismaNS.empty}
        ${to ? PrismaNS.sql`AND "transaction_date" <= ${to}` : PrismaNS.empty}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    return this.netSpendingOverTime(rows, refunds);
  }

  private linkedRefundWhere(
    userId: string,
    from?: Date,
    to?: Date,
  ): Prisma.FinTransactionWhereInput {
    return {
      userId,
      type: 'CREDIT',
      status: 'CONFIRMED',
      linkedTransactionId: { not: null },
      transferGroupId: null,
      ...(from || to
        ? {
            transactionDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };
  }

  private async linkedRefundTotal(
    userId: string,
    from?: Date,
    to?: Date,
  ): Promise<Prisma.Decimal> {
    const refundAggregate = await this.prisma.finTransaction.aggregate({
      where: this.linkedRefundWhere(userId, from, to),
      _sum: { amountBaseCurrency: true },
    });
    return toMoney(refundAggregate._sum.amountBaseCurrency ?? null);
  }

  /** Expenses already net of the partial reversals linked to their purchase. */
  private async netLinkedRefunds(
    rows: CashFlowRow[],
    userId: string,
    from?: Date,
    to?: Date,
  ): Promise<CashFlowRow[]> {
    const refunds = await this.linkedRefundTotal(userId, from, to);
    if (refunds.isZero()) {
      return rows;
    }
    const expenseRow = rows.find(
      (row) => row.type === 'DEBIT' && row.status === 'CONFIRMED',
    );
    if (!expenseRow) {
      return [
        ...rows,
        {
          type: 'DEBIT',
          status: 'CONFIRMED',
          _sum: { amountBaseCurrency: refunds.negated() },
          _count: { _all: 0 },
        },
      ];
    }
    return rows.map((row) =>
      row === expenseRow
        ? {
            ...row,
            _sum: {
              amountBaseCurrency: toMoney(
                row._sum.amountBaseCurrency ?? null,
              ).minus(refunds),
            },
          }
        : row,
    );
  }

  private netSpendingByCategory(
    rows: CategorySpendRow[],
    refunds: CategorySpendRow[],
  ): CategorySpendRow[] {
    if (refunds.length === 0) {
      return rows;
    }
    const refundByCategory = new Map(
      refunds.map((row) => [
        row.categoryId,
        toMoney(row._sum.amountBaseCurrency ?? null),
      ]),
    );
    const merged = rows.map((row) => ({
      categoryId: row.categoryId,
      _sum: {
        amountBaseCurrency: toMoney(row._sum.amountBaseCurrency ?? null).minus(
          refundByCategory.get(row.categoryId) ?? 0,
        ),
      },
    }));
    const known = new Set(rows.map((row) => row.categoryId));
    for (const [categoryId, refund] of refundByCategory) {
      if (!known.has(categoryId)) {
        merged.push({
          categoryId,
          _sum: { amountBaseCurrency: refund.negated() },
        });
      }
    }
    return merged;
  }

  private netSpendingOverTime(
    rows: Array<{ bucket: Date; type: string; total: string }>,
    refunds: Array<{ bucket: Date; total: string }>,
  ): SpendingPointRow[] {
    const points = rows.map((row) => ({
      bucket: new Date(row.bucket),
      type: row.type,
      total: toMoney(row.total),
    }));
    if (refunds.length === 0) {
      return points;
    }
    const pending = new Map(
      refunds.map((row) => [
        new Date(row.bucket).toISOString(),
        toMoney(row.total),
      ]),
    );
    const netted = points.map((point) => {
      const key = point.bucket.toISOString();
      const refund = pending.get(key);
      if (!refund || point.type !== 'DEBIT') {
        return point;
      }
      pending.delete(key);
      return { ...point, total: point.total.minus(refund) };
    });
    for (const [key, refund] of pending) {
      netted.push({
        bucket: new Date(key),
        type: 'DEBIT',
        total: refund.negated(),
      });
    }
    return netted;
  }

  listBudgets(userId: string) {
    return this.prisma.finBudget.findMany({
      where: { userId },
      include: { category: true, categories: true },
      orderBy: { periodStart: 'desc' },
    });
  }

  /** Spent money read from the movements so every surface shows the same figure. */
  sumBudgetSpent(scope: BudgetSpentScope) {
    return sumBudgetSpent(this.prisma, scope);
  }
}
