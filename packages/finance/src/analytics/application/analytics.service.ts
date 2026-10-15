import { Injectable } from '@nestjs/common';
import type { Prisma } from '@personal-os/database';
import { BalanceSheetService } from '../../balance-sheet/application/balance-sheet.service';
import { decimalToString } from '../../shared/domain/mappers';
import {
  ratioPercent,
  roundDecimal,
  scalarNumber,
  toMoney,
} from '../../shared/domain/money';
import { AnalyticsRepository } from '../infrastructure/analytics.repository';

const UNCATEGORIZED_NAME = 'Sin categoría';
const MISSING_CATEGORY_NAME = 'Categoría no disponible';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly repo: AnalyticsRepository,
    private readonly balanceSheet: BalanceSheetService,
  ) {}

  async getAnalyticsSummary(
    userId: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const from = dateFrom ? new Date(dateFrom) : undefined;
    const to = dateTo ? new Date(dateTo) : undefined;
    const [sheet, aggregates] = await Promise.all([
      this.balanceSheet.getBalanceSheet(userId),
      this.repo.getCashFlowAggregates(userId, from, to),
    ]);

    let income = toMoney(0);
    let expenses = toMoney(0);
    for (const row of aggregates) {
      if (row.status !== 'CONFIRMED') {
        continue;
      }
      const amount = toMoney(row._sum?.amountBaseCurrency ?? 0);
      if (row.type === 'CREDIT') {
        income = income.plus(amount);
      }
      if (row.type === 'DEBIT') {
        expenses = expenses.plus(amount);
      }
    }

    return {
      netWorth: sheet.global.netWorth,
      cashFlow: decimalToString(roundDecimal(income.minus(expenses))),
      baseCurrency: sheet.baseCurrency,
      balanceStatus: sheet.global.status,
      balanceIssues: sheet.global.issues,
      totals: {
        accountBalance: sheet.global.assets.accounts,
        cardDebt: sheet.global.liabilities.creditCards,
        income: decimalToString(roundDecimal(income)),
        expenses: decimalToString(roundDecimal(expenses)),
      },
    };
  }

  async getSpendingByCategory(
    userId: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const grouped = await this.repo.getSpendingByCategory(
      userId,
      dateFrom ? new Date(dateFrom) : undefined,
      dateTo ? new Date(dateTo) : undefined,
    );
    const categoryIds = [
      ...new Set(
        grouped
          .map((item) => item.categoryId)
          .filter((id): id is string => id != null),
      ),
    ];
    const categories = await this.repo.findCategoriesByIds(userId, categoryIds);
    const byId = new Map(
      categories.map((category) => [category.id, category] as const),
    );

    return grouped.map((item) => {
      const total = roundDecimal(item._sum.amountBaseCurrency);
      if (item.categoryId == null) {
        return {
          categoryId: null,
          name: UNCATEGORIZED_NAME,
          color: null,
          icon: null,
          total: decimalToString(total),
        };
      }
      const category = byId.get(item.categoryId);
      return {
        categoryId: item.categoryId,
        name: category?.name ?? MISSING_CATEGORY_NAME,
        color: category?.color ?? null,
        icon: category?.icon ?? null,
        total: decimalToString(total),
      };
    });
  }

  async getSpendingOverTime(
    userId: string,
    dateFrom?: string,
    dateTo?: string,
    granularity: 'day' | 'week' | 'month' = 'day',
  ) {
    const rows = await this.repo.getSpendingOverTime(
      userId,
      dateFrom ? new Date(dateFrom) : undefined,
      dateTo ? new Date(dateTo) : undefined,
      granularity,
    );

    const byDate = new Map<
      string,
      { date: string; expenses: Prisma.Decimal; income: Prisma.Decimal }
    >();

    for (const row of rows) {
      const date =
        row.bucket instanceof Date
          ? row.bucket.toISOString().slice(0, 10)
          : String(row.bucket).slice(0, 10);
      const entry = byDate.get(date) ?? {
        date,
        expenses: toMoney(0),
        income: toMoney(0),
      };
      if (row.type === 'DEBIT') {
        entry.expenses = entry.expenses.plus(row.total);
      }
      if (row.type === 'CREDIT') {
        entry.income = entry.income.plus(row.total);
      }
      byDate.set(date, entry);
    }

    return {
      points: [...byDate.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((point) => ({
          date: point.date,
          expenses: decimalToString(roundDecimal(point.expenses)),
          income: decimalToString(roundDecimal(point.income)),
        })),
    };
  }

  async getBudgetStatus(userId: string) {
    const budgets = await this.repo.listBudgets(userId);
    return budgets.map((budget) => {
      const limit = toMoney(budget.amountLimit);
      const spent = toMoney(budget.amountSpent);
      return {
        id: budget.id,
        categoryId: budget.categoryId,
        category: budget.name ?? budget.category?.name ?? 'Presupuesto',
        color: budget.category?.color ?? null,
        icon: budget.category?.icon ?? null,
        periodType: budget.periodType,
        periodStart: budget.periodStart.toISOString().slice(0, 10),
        periodEnd: budget.periodEnd.toISOString().slice(0, 10),
        amountLimit: decimalToString(limit),
        amountSpent: decimalToString(spent),
        pctUsed: ratioPercent(spent, limit),
        threshold: scalarNumber(budget.alertThresholdPct),
      };
    });
  }
}
