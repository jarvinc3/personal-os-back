import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import {
  sumBudgetSpent,
  type BudgetSpentScope,
} from '../../shared/infrastructure/budget-spent.reader';

/** Budgets read for the status view, with their expense read from movements. */
@Injectable()
export class AnalyticsBudgetsRepository {
  constructor(private readonly prisma: PrismaService) {}

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
