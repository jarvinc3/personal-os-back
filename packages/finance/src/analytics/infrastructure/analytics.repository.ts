import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import type { BudgetSpentScope } from '../../shared/infrastructure/budget-spent.reader';
import { AnalyticsBudgetsRepository } from './analytics-budgets.repository';
import {
  AnalyticsMovementsRepository,
  type SpendingOverTimeQuery,
} from './analytics-movements.repository';

export type { SpendingOverTimeQuery } from './analytics-movements.repository';

/**
 * Analytics reads: movements with their reversals netted and the budgets that
 * feed the status view. The service keeps the same methods as before.
 */
@Injectable()
export class AnalyticsRepository {
  readonly movements: AnalyticsMovementsRepository;
  readonly budgets: AnalyticsBudgetsRepository;

  constructor(prisma: PrismaService) {
    this.movements = new AnalyticsMovementsRepository(prisma);
    this.budgets = new AnalyticsBudgetsRepository(prisma);
  }

  getCashFlowAggregates(userId: string, from?: Date, to?: Date) {
    return this.movements.getCashFlowAggregates(userId, from, to);
  }

  getSpendingByCategory(userId: string, from?: Date, to?: Date) {
    return this.movements.getSpendingByCategory(userId, from, to);
  }

  findCategoriesByIds(userId: string, ids: string[]) {
    return this.movements.findCategoriesByIds(userId, ids);
  }

  getSpendingOverTime(input: SpendingOverTimeQuery) {
    return this.movements.getSpendingOverTime(input);
  }

  listBudgets(userId: string) {
    return this.budgets.listBudgets(userId);
  }

  sumBudgetSpent(scope: BudgetSpentScope) {
    return this.budgets.sumBudgetSpent(scope);
  }
}
