import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  clampPageLimit,
  toCursorPage,
  type CursorQueryDto,
} from '@personal-os/core';
import { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { assertRestored } from '../../shared/application/assert-restored';
import { budgetCategoryIds } from '../../shared/infrastructure/budget-spent.reader';
import { endOfUtcDay } from '../../shared/domain/local-day';
import {
  BUDGET_ROLLOVER,
  carriedOverFrom,
  type BudgetRollover,
} from '../domain/budget-rollover';
import { nextBudgetPeriod } from '../domain/budget-period';
import { PlanningRepository } from '../infrastructure/planning.repository';
import type { CreateBudgetDto } from '../presentation/dto/create-budget.dto';
import type { UpdateBudgetDto } from '../presentation/dto/update-budget.dto';
import {
  budgetContentFields,
  budgetScheduleFields,
} from './planning-budget-changes';
import { mapBudget } from './planning-mappers';

/** Budget row as the repository returns it: category plus every joined category. */
type BudgetRow = NonNullable<
  Awaited<ReturnType<PlanningRepository['findBudget']>>
>;

type BudgetOverlapCheck = {
  userId: string;
  categoryIds: string[];
  periodStart: Date;
  periodEnd: Date;
  excludeBudgetId?: string;
};

/** Budgets of a user: spend, periods, recurring copies and carry-over. */
export class PlanningBudgets {
  constructor(
    private readonly repo: PlanningRepository,
    private readonly ownership: FinanceOwnershipService,
    private readonly ledger: LedgerQueryService,
  ) {}

  async listBudgets(userId: string) {
    const rows = await this.repo.listBudgets(userId);
    return Promise.all(rows.map((row) => this.mapWithSpent(userId, row)));
  }

  async listBudgetsPage(userId: string, query: CursorQueryDto) {
    const rows = await this.repo.listBudgetsPage(userId, query);
    const page = toCursorPage(rows, clampPageLimit(query.limit), (row) =>
      row.periodStart.toISOString(),
    );
    const items = await Promise.all(
      page.items.map((row) => this.mapWithSpent(userId, row)),
    );
    return { ...page, items };
  }

  async getBudget(userId: string, id: string) {
    const row = await this.repo.findBudget(userId, id);
    if (!row) {
      throw new NotFoundException('Presupuesto no encontrado');
    }
    return this.mapWithSpent(userId, row);
  }

  /** Budgets with the same shape as `getBudget`, in batch and without throwing. */
  async lookupBudgets(userId: string, ids: readonly string[]) {
    const rows = await this.repo.findBudgetsByIds(userId, ids);
    const mapped = await Promise.all(
      rows.map((row) => this.mapWithSpent(userId, row)),
    );
    return new Map(mapped.map((row) => [row.id, row]));
  }

  async createBudget(userId: string, dto: CreateBudgetDto) {
    for (const categoryId of dto.categoryIds) {
      await this.ownership.assertExpenseCategory(userId, categoryId);
    }
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    await this.assertCategoriesNotBudgeted({
      userId,
      categoryIds: dto.categoryIds,
      periodStart,
      periodEnd,
    });
    const budgetId = await this.repo.createBudget(
      userId,
      {
        categoryId: dto.categoryIds[0],
        name: dto.name ?? null,
        includeChildren: dto.includeChildren ?? true,
        rollover: dto.rollover ?? 'NONE',
        recurring: dto.recurring ?? false,
        periodType: dto.periodType,
        periodStart,
        periodEnd,
        amountLimit: dto.amountLimit,
        amountSpent: 0,
        alertThresholdPct: dto.alertThresholdPct ?? 80,
      },
      dto.categoryIds,
    );
    const created = await this.repo.findBudget(userId, budgetId);
    if (!created) {
      throw new NotFoundException('Presupuesto no encontrado');
    }
    await this.applyCarriedOver(userId, created);
    const saved = (await this.repo.findBudget(userId, budgetId)) ?? created;
    return this.mapWithSpent(userId, saved);
  }

  async updateBudget(userId: string, id: string, dto: UpdateBudgetDto) {
    if (dto.categoryIds) {
      for (const categoryId of dto.categoryIds) {
        await this.ownership.assertExpenseCategory(userId, categoryId);
      }
      const existing = await this.repo.findBudget(userId, id);
      if (!existing) {
        throw new NotFoundException('Presupuesto no encontrado');
      }
      await this.assertCategoriesNotBudgeted({
        userId,
        categoryIds: dto.categoryIds,
        periodStart: dto.periodStart
          ? new Date(dto.periodStart)
          : existing.periodStart,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : existing.periodEnd,
        excludeBudgetId: id,
      });
    }
    const updatedId = await this.repo.updateBudget(
      userId,
      id,
      { ...budgetContentFields(dto), ...budgetScheduleFields(dto) },
      dto.categoryIds,
    );
    if (!updatedId) {
      throw new NotFoundException('Presupuesto no encontrado');
    }
    const updated = await this.repo.findBudget(userId, updatedId);
    if (!updated) {
      throw new NotFoundException('Presupuesto no encontrado');
    }
    await this.applyCarriedOver(userId, updated);
    const saved = (await this.repo.findBudget(userId, updatedId)) ?? updated;
    return this.mapWithSpent(userId, saved);
  }

  async getBudgetTransactions(
    userId: string,
    id: string,
    query: CursorQueryDto,
  ) {
    const budget = await this.repo.findBudget(userId, id);
    if (!budget) {
      throw new NotFoundException('Presupuesto no encontrado');
    }
    const categoryIds = budget.categories.map((entry) => entry.categoryId);
    if (budget.includeChildren) {
      categoryIds.push(...(await this.repo.listChildCategoryIds(categoryIds)));
    }
    if (categoryIds.length === 0) {
      return { items: [], nextCursor: null, hasMore: false };
    }
    return this.ledger.listTransactions(userId, {
      cursor: query.cursor,
      limit: query.limit,
      categoryIds,
      type: 'DEBIT',
      status: 'CONFIRMED',
      dateFrom: budget.periodStart.toISOString(),
      dateTo: endOfUtcDay(budget.periodEnd).toISOString(),
    });
  }

  /**
   * Creates the next period of every recurring budget whose period ended. The
   * overlapping check makes the job idempotent. The scheduler calls it daily.
   */
  async createRecurringBudgets(now: Date) {
    const budgets = await this.repo.listRecurringBudgets();
    let created = 0;
    for (const budget of budgets) {
      if (budget.periodEnd.getTime() >= now.getTime()) {
        continue;
      }
      const categoryIds = budget.categories.map((entry) => entry.categoryId);
      if (categoryIds.length === 0) {
        continue;
      }
      const next = nextBudgetPeriod({
        periodType: budget.periodType,
        periodStart: budget.periodStart,
        periodEnd: budget.periodEnd,
      });
      const overlapping = await this.repo.findOverlappingBudgetForCategories(
        budget.userId,
        categoryIds,
        next.periodStart,
        next.periodEnd,
      );
      if (overlapping) {
        continue;
      }
      const newBudgetId = await this.repo.createBudget(
        budget.userId,
        {
          categoryId: categoryIds[0] ?? null,
          name: budget.name,
          includeChildren: budget.includeChildren,
          rollover: budget.rollover,
          recurring: budget.recurring,
          periodType: budget.periodType,
          periodStart: next.periodStart,
          periodEnd: next.periodEnd,
          amountLimit: Number(budget.amountLimit),
          amountSpent: 0,
          alertThresholdPct: Number(budget.alertThresholdPct),
        },
        categoryIds,
      );
      const newBudget = await this.repo.findBudget(budget.userId, newBudgetId);
      if (newBudget) {
        await this.applyCarriedOver(budget.userId, newBudget);
      }
      created += 1;
    }
    return { created };
  }

  async deleteBudget(userId: string, id: string) {
    const deleted = await this.repo.deleteBudget(userId, id);
    if (deleted.count === 0) {
      throw new NotFoundException('Presupuesto no encontrado');
    }
    return { success: true };
  }

  async restoreBudget(userId: string, id: string, now: Date) {
    const restored = await this.repo.restoreBudget(userId, id, now);
    assertRestored(restored, 'Budget not found');
    return { success: true };
  }

  /**
   * The spent figure comes from the movements, so the budget can never show a
   * total that disagrees with its own list. The stored counter keeps feeding
   * only the threshold alerts.
   */
  private async mapWithSpent(userId: string, row: BudgetRow) {
    return mapBudget({
      ...row,
      amountSpent: await this.budgetSpent(userId, row),
    });
  }

  private budgetSpent(userId: string, row: BudgetRow) {
    return this.repo.sumBudgetSpent({
      userId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      categoryIds: budgetCategoryIds(row),
      includeChildren: row.includeChildren,
    });
  }

  private async applyCarriedOver(
    userId: string,
    budget: {
      id: string;
      rollover: string;
      periodStart: Date;
      categories: Array<{ categoryId: string }>;
    },
  ): Promise<void> {
    const categoryIds = budget.categories.map((entry) => entry.categoryId);
    let carriedOver = 0;
    if (categoryIds.length > 0 && budget.rollover !== BUDGET_ROLLOVER.NONE) {
      const previous = await this.repo.findPreviousBudgetForCategories(
        userId,
        categoryIds,
        budget.periodStart,
        budget.id,
      );
      if (previous && previous.categories.length === categoryIds.length) {
        carriedOver = carriedOverFrom({
          rollover: budget.rollover as BudgetRollover,
          previousLimit: Number(previous.amountLimit),
          previousCarriedOver: Number(previous.carriedOver),
          previousSpent: Number(previous.amountSpent),
        });
      }
    }
    await this.repo.updateBudget(userId, budget.id, { carriedOver });
  }

  private async assertCategoriesNotBudgeted({
    userId,
    categoryIds,
    periodStart,
    periodEnd,
    excludeBudgetId,
  }: BudgetOverlapCheck): Promise<void> {
    const conflict = await this.repo.findOverlappingBudgetForCategories(
      userId,
      categoryIds,
      periodStart,
      periodEnd,
      excludeBudgetId,
    );
    if (!conflict) {
      return;
    }
    const conflicting = conflict.categories.find((entry) =>
      categoryIds.includes(entry.categoryId),
    );
    throw new ConflictException({
      code: 'CATEGORY_ALREADY_BUDGETED',
      message: `${conflicting?.category.name ?? 'Una categoría'} ya está en el presupuesto ${conflict.name ?? 'de este periodo'}.`,
    });
  }
}
