import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { assertRestored } from '../../shared/application/assert-restored';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { CatalogRepository } from '../infrastructure/catalog.repository';
import type { CreateCategoryDto } from '../presentation/dto/create-category.dto';
import type { UpdateCategoryDto } from '../presentation/dto/update-category.dto';

/** Categories of the catalog: their parent, their type and the soft delete. */
@Injectable()
export class CatalogCategoriesService {
  constructor(
    private readonly repo: CatalogRepository,
    private readonly ownership: FinanceOwnershipService,
  ) {}

  listCategories(userId: string, type?: 'EXPENSE' | 'INCOME') {
    return this.repo.listCategories(userId, type);
  }

  /** Categories visible to the user, loaded in batch for the entity lookup. */
  async lookupCategories(userId: string, ids: readonly string[]) {
    const rows = await this.repo.findCategoriesByIds(userId, ids);
    return new Map(rows.map((row) => [row.id, row]));
  }

  async createCategory(userId: string, dto: CreateCategoryDto) {
    if (dto.type === 'TRANSFER') {
      throw new BadRequestException(
        'El tipo de categoría debe ser EXPENSE o INCOME',
      );
    }
    const type = dto.type ?? 'EXPENSE';
    if (dto.parentId) {
      await this.ownership.assertParentCategory(
        userId,
        dto.parentId,
        undefined,
        type,
      );
    }
    return this.repo.createCategory(userId, {
      name: dto.name,
      icon: dto.icon,
      color: dto.color,
      parentId: dto.parentId,
      type,
    });
  }

  async updateCategory(userId: string, id: string, dto: UpdateCategoryDto) {
    if (dto.type === 'TRANSFER') {
      throw new BadRequestException(
        'El tipo de categoría debe ser EXPENSE o INCOME',
      );
    }
    const existing = await this.ownership.assertCategoryVisible(userId, id);
    const nextParentId =
      dto.parentId === undefined ? existing.parentId : dto.parentId;
    const nextType = dto.type ?? existing.type;
    const typeChanged = dto.type !== undefined && dto.type !== existing.type;

    if (typeChanged && nextParentId) {
      throw new BadRequestException(
        'Cannot change type while the category has a parent',
      );
    }

    if (typeof nextParentId === 'string') {
      await this.ownership.assertParentCategory(
        userId,
        nextParentId,
        id,
        nextType,
      );
    }

    const cascadeType =
      typeChanged &&
      !nextParentId &&
      (dto.type === 'EXPENSE' || dto.type === 'INCOME')
        ? dto.type
        : undefined;

    const updated = await this.repo.updateCategory(
      userId,
      id,
      {
        name: dto.name,
        icon: dto.icon,
        color: dto.color,
        parentId: dto.parentId,
        ...(cascadeType ? { type: cascadeType } : {}),
      },
      cascadeType,
    );
    if (!updated) {
      throw new NotFoundException('Categoría no encontrada');
    }
    return updated;
  }

  async deleteCategory(userId: string, id: string) {
    const deleted = await this.repo.deleteCategory(userId, id);
    if (deleted.count === 0) {
      throw new NotFoundException('Categoría no encontrada');
    }
    return { success: true };
  }

  async restoreCategory(userId: string, id: string, now: Date) {
    const restored = await this.repo.restoreCategory(userId, id, now);
    assertRestored(restored, 'Category not found');
    return { success: true };
  }
}
