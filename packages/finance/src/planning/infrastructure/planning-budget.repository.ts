import { Injectable } from '@nestjs/common';
import { clampPageLimit, type CursorQueryDto } from '@personal-os/core';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import {
  DELETION_ENTITY,
  DELETION_MODEL,
  toDeletionValues,
} from '../../shared/domain/deletion-snapshot';
import {
  sumBudgetSpent,
  type BudgetSpentScope,
} from '../../shared/infrastructure/budget-spent.reader';
import { decodeCursorPosition } from '../../shared/infrastructure/cursor-window';
import { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';

type BudgetUpdate = {
  userId: string;
  id: string;
  data: Prisma.FinBudgetUncheckedUpdateManyInput;
  categoryIds?: string[];
};

type BudgetOverlap = {
  userId: string;
  categoryIds: string[];
  periodStart: Date;
  periodEnd: Date;
  excludeBudgetId?: string;
};

type PreviousBudget = Omit<BudgetOverlap, 'periodEnd'>;

/** Budgets: their cursor page, their categories, their spend and their deletion. */
@Injectable()
export class PlanningBudgetRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: DeletionJournalRepository,
  ) {}

  listBudgets(userId: string) {
    return this.prisma.finBudget.findMany({
      where: { userId },
      include: { category: true, categories: { include: { category: true } } },
      orderBy: { periodStart: 'desc' },
    });
  }

  /** Spent money read from the movements so it matches the budget's list. */
  sumBudgetSpent(scope: BudgetSpentScope) {
    return sumBudgetSpent(this.prisma, scope);
  }

  listBudgetsPage(userId: string, query: CursorQueryDto) {
    const limit = clampPageLimit(query.limit);
    const after = decodeCursorPosition(query.cursor);
    const baseWhere: Prisma.FinBudgetWhereInput = { userId };
    const where: Prisma.FinBudgetWhereInput = after
      ? {
          AND: [
            baseWhere,
            {
              OR: [
                { periodStart: { lt: after.date } },
                { periodStart: after.date, id: { lt: after.id } },
              ],
            },
          ],
        }
      : baseWhere;
    return this.prisma.finBudget.findMany({
      where,
      include: { category: true, categories: { include: { category: true } } },
      orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  }

  findBudget(userId: string, id: string) {
    return this.prisma.finBudget.findFirst({
      where: { id, userId },
      include: { category: true, categories: { include: { category: true } } },
    });
  }

  findBudgetsByIds(userId: string, ids: readonly string[]) {
    return this.prisma.finBudget.findMany({
      where: { id: { in: [...ids] }, userId },
      include: { category: true, categories: { include: { category: true } } },
    });
  }

  createBudget(
    userId: string,
    data: Omit<Prisma.FinBudgetUncheckedCreateInput, 'userId'>,
    categoryIds: string[],
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const budget = await tx.finBudget.create({ data: { ...data, userId } });
      await tx.finBudgetCategory.createMany({
        data: categoryIds.map((categoryId) => ({
          budgetId: budget.id,
          categoryId,
        })),
      });
      return budget.id;
    });
  }

  updateBudget({
    userId,
    id,
    data,
    categoryIds,
  }: BudgetUpdate): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.finBudget.updateMany({
        where: { id, userId },
        data,
      });
      if (updateResult.count === 0) {
        return null;
      }
      if (categoryIds) {
        await tx.finBudgetCategory.deleteMany({ where: { budgetId: id } });
        await tx.finBudgetCategory.createMany({
          data: categoryIds.map((categoryId) => ({ budgetId: id, categoryId })),
        });
      }
      return id;
    });
  }

  findOverlappingBudgetForCategories({
    userId,
    categoryIds,
    periodStart,
    periodEnd,
    excludeBudgetId,
  }: BudgetOverlap) {
    return this.prisma.finBudget.findFirst({
      where: {
        userId,
        ...(excludeBudgetId ? { id: { not: excludeBudgetId } } : {}),
        periodStart: { lte: periodEnd },
        periodEnd: { gte: periodStart },
        OR: [
          { categoryId: { in: categoryIds } },
          { categories: { some: { categoryId: { in: categoryIds } } } },
        ],
      },
      include: { categories: { include: { category: true } } },
    });
  }

  findPreviousBudgetForCategories({
    userId,
    categoryIds,
    periodStart,
    excludeBudgetId,
  }: PreviousBudget) {
    return this.prisma.finBudget.findFirst({
      where: {
        userId,
        ...(excludeBudgetId ? { id: { not: excludeBudgetId } } : {}),
        periodEnd: { lt: periodStart },
        categories: {
          some: { categoryId: { in: categoryIds } },
          every: { categoryId: { in: categoryIds } },
        },
      },
      include: { categories: true },
      orderBy: { periodEnd: 'desc' },
    });
  }

  async listChildCategoryIds(parentIds: string[]): Promise<string[]> {
    if (parentIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.finCategory.findMany({
      where: { parentId: { in: parentIds } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  listRecurringBudgets() {
    return this.prisma.finBudget.findMany({
      where: { recurring: true },
      include: { categories: { include: { category: true } } },
    });
  }

  deleteBudget(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const budget = await tx.finBudget.findFirst({
        where: { id, userId },
        include: { alerts: true },
      });
      if (!budget) {
        return { count: 0 };
      }
      const { alerts, ...budgetRow } = budget;
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.budget,
        entityId: id,
        snapshot: {
          rows: [
            {
              model: DELETION_MODEL.budget,
              values: toDeletionValues(budgetRow),
            },
            ...alerts.map((alert) => ({
              model: DELETION_MODEL.budgetAlert,
              values: toDeletionValues(alert),
            })),
          ],
        },
      });
      return tx.finBudget.deleteMany({ where: { id, userId } });
    });
  }

  restoreBudget(userId: string, id: string, now: Date) {
    return this.journal.restore(userId, DELETION_ENTITY.budget, id, now);
  }
}
