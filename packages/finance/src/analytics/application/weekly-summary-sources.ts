import { Injectable } from '@nestjs/common';
import { CatalogService } from '../../catalog/application/catalog.service';
import { PlanningService } from '../../planning/application/planning.service';
import { AnalyticsService } from './analytics.service';

type WeeklySummarySourcesInput = {
  userId: string;
  weekStart: string;
  weekEndBound: string;
  rangeFrom: string;
};

/** Reads the finance sources that feed one weekly summary. */
@Injectable()
export class WeeklySummarySources {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly planning: PlanningService,
    private readonly catalog: CatalogService,
  ) {}

  async load(input: WeeklySummarySourcesInput) {
    const { userId, weekStart, weekEndBound, rangeFrom } = input;
    const [overTime, spendingByCategory, budgets, loans, cards] =
      await Promise.all([
        this.analytics.getSpendingOverTime({
          userId,
          dateFrom: rangeFrom,
          dateTo: weekEndBound,
          granularity: 'week',
        }),
        this.analytics.getSpendingByCategory(userId, weekStart, weekEndBound),
        this.analytics.getBudgetStatus(userId),
        this.planning.listLoans(userId),
        this.catalog.listCards(userId),
      ]);
    return { overTime, spendingByCategory, budgets, loans, cards };
  }
}
