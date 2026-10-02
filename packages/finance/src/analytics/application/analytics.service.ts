import { Injectable } from '@nestjs/common';
import { BalanceSheetService } from '../../balance-sheet/application/balance-sheet.service';
import { decimalToString } from '../../shared/domain/mappers';
import { roundMoney } from '../../shared/domain/money';
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

    let income = 0;
    let expenses = 0;
    for (const row of aggregates) {
      if (row.status !== 'CONFIRMED') {
        continue;
      }
      const sum = Number(row._sum?.amountBaseCurrency ?? 0);
      if (row.type === 'CREDIT') {
        income += sum;
      }
      if (row.type === 'DEBIT') {
        expenses += sum;
      }
    }

    return {
      netWorth: sheet.global.netWorth,
      cashFlow: decimalToString(roundMoney(income - expenses)),
      baseCurrency: sheet.baseCurrency,
      balanceStatus: sheet.global.status,
      balanceIssues: sheet.global.issues,
      totals: {
        accountBalance: sheet.global.assets.accounts,
        cardDebt: sheet.global.liabilities.creditCards,
        income: decimalToString(roundMoney(income)),
        expenses: decimalToString(roundMoney(expenses)),
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
      const total = item._sum.amountBaseCurrency
        ? Number(item._sum.amountBaseCurrency)
        : 0;
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
      { date: string; expenses: number; income: number }
    >();

    for (const row of rows) {
      const date =
        row.bucket instanceof Date
          ? row.bucket.toISOString().slice(0, 10)
          : String(row.bucket).slice(0, 10);
      const entry = byDate.get(date) ?? { date, expenses: 0, income: 0 };
      const total = Number(row.total) || 0;
      if (row.type === 'DEBIT') {
        entry.expenses += total;
      }
      if (row.type === 'CREDIT') {
        entry.income += total;
      }
      byDate.set(date, entry);
    }

    return {
      points: [...byDate.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((point) => ({
          date: point.date,
          expenses: decimalToString(roundMoney(point.expenses)),
          income: decimalToString(roundMoney(point.income)),
        })),
    };
  }

  async getBudgetStatus(userId: string) {
    const budgets = await this.repo.listBudgets(userId);
    return budgets.map((budget) => {
      const limit = Number(budget.amountLimit);
      const spent = Number(budget.amountSpent);
      const pctUsed = limit > 0 ? (spent / limit) * 100 : 0;
      return {
        id: budget.id,
        categoryId: budget.categoryId,
        category: budget.category.name,
        color: budget.category.color,
        icon: budget.category.icon,
        periodType: budget.periodType,
        periodStart: budget.periodStart.toISOString().slice(0, 10),
        periodEnd: budget.periodEnd.toISOString().slice(0, 10),
        amountLimit: decimalToString(limit),
        amountSpent: decimalToString(spent),
        pctUsed,
        threshold: Number(budget.alertThresholdPct),
      };
    });
  }
}
