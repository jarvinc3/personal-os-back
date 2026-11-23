import { Injectable } from '@nestjs/common';
import { Prisma, PrismaService } from '@personal-os/database';
import {
  DELETION_ENTITY,
  DELETION_MODEL,
  toDeletionValues,
} from '../../shared/domain/deletion-snapshot';
import { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';

export type CategoryUpdate = {
  userId: string;
  id: string;
  categoryUpdate: Prisma.FinCategoryUncheckedUpdateInput;
  cascadeTypeToChildren?: 'EXPENSE' | 'INCOME';
};

/** Categories: their list, their update with cascade and their deletion. */
@Injectable()
export class CatalogCategoryRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: DeletionJournalRepository,
  ) {}

  /** Categories the user can see: their own plus the system ones. */
  findCategoriesByIds(userId: string, ids: readonly string[]) {
    return this.prisma.finCategory.findMany({
      where: { id: { in: [...ids] }, OR: [{ userId }, { isSystem: true }] },
    });
  }

  listCategories(userId: string, type?: 'EXPENSE' | 'INCOME') {
    return this.prisma.finCategory.findMany({
      where: {
        OR: [{ userId }, { isSystem: true }],
        ...(type ? { type } : {}),
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
  }

  createCategory(
    userId: string,
    categoryInput: Prisma.FinCategoryUncheckedCreateInput,
  ) {
    return this.prisma.finCategory.create({
      data: { ...categoryInput, userId, isSystem: false },
    });
  }

  updateCategory({
    userId,
    id,
    categoryUpdate,
    cascadeTypeToChildren,
  }: CategoryUpdate) {
    return this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.finCategory.updateMany({
        where: { id, userId, isSystem: false },
        data: categoryUpdate,
      });
      if (updateResult.count === 0) {
        return null;
      }
      if (cascadeTypeToChildren) {
        await tx.finCategory.updateMany({
          where: { parentId: id, userId },
          data: { type: cascadeTypeToChildren },
        });
      }
      return tx.finCategory.findFirst({ where: { id, userId } });
    });
  }

  deleteCategory(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const category = await tx.finCategory.findFirst({
        where: { id, userId, isSystem: false },
      });
      if (!category) {
        return { count: 0 };
      }
      const children = await tx.finCategory.findMany({
        where: { userId, parentId: id },
      });
      const categoryIds = [id, ...children.map((child) => child.id)];
      const budgets = await tx.finBudget.findMany({
        where: { userId, categoryId: { in: categoryIds } },
        include: { alerts: true },
      });
      const cleared = await tx.finTransaction.findMany({
        where: { userId, categoryId: { in: categoryIds } },
        select: { id: true, categoryId: true },
      });
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.category,
        entityId: id,
        snapshot: {
          rows: [
            {
              model: DELETION_MODEL.category,
              values: toDeletionValues(category),
            },
            ...children.map((child) => ({
              model: DELETION_MODEL.category,
              values: toDeletionValues(child),
            })),
            ...budgets.map((budget) => ({
              model: DELETION_MODEL.budget,
              values: toDeletionValues({ ...budget, alerts: undefined }),
            })),
            ...budgets.flatMap((budget) =>
              budget.alerts.map((alert) => ({
                model: DELETION_MODEL.budgetAlert,
                values: toDeletionValues(alert),
              })),
            ),
          ],
          categoriesCleared: cleared.map((row) => ({
            transactionId: row.id,
            categoryId: row.categoryId as string,
          })),
        },
      });
      await tx.finTransaction.updateMany({
        where: { userId, categoryId: { in: categoryIds } },
        data: { categoryId: null },
      });
      return tx.finCategory.deleteMany({
        where: { id: { in: categoryIds }, userId, isSystem: false },
      });
    });
  }

  restoreCategory(userId: string, id: string, now: Date) {
    return this.journal.restore({
      userId,
      entityType: DELETION_ENTITY.category,
      entityId: id,
      now,
    });
  }
}
