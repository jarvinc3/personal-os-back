import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { assertRestored } from '../../shared/application/assert-restored';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { CatalogCategoryRepository } from '../infrastructure/catalog-category.repository';
import type { CreateCategoryDto } from '../presentation/dto/create-category.dto';
import type { UpdateCategoryDto } from '../presentation/dto/update-category.dto';

/** Categories of the catalog: their parent, their type and the soft delete. */
@Injectable()
export class CatalogCategoriesService {
  constructor(
    private readonly repo: CatalogCategoryRepository,
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
    this.assertCategoryType(dto.type);
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
    this.assertCategoryType(dto.type);
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

    const cascadeType = this.resolveCascadeType({
      typeChanged,
      nextParentId,
      requestedType: dto.type,
    });

    const updated = await this.repo.updateCategory({
      userId,
      id,
      categoryUpdate: {
        name: dto.name,
        icon: dto.icon,
        color: dto.color,
        parentId: dto.parentId,
        ...(cascadeType ? { type: cascadeType } : {}),
      },
      cascadeTypeToChildren: cascadeType,
    });
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

  private assertCategoryType(
    type: 'EXPENSE' | 'INCOME' | 'TRANSFER' | undefined,
  ): asserts type is 'EXPENSE' | 'INCOME' | undefined {
    if (type === 'TRANSFER') {
      throw new BadRequestException(
        'El tipo de categoría debe ser EXPENSE o INCOME',
      );
    }
  }

  private resolveCascadeType({
    typeChanged,
    nextParentId,
    requestedType,
  }: {
    typeChanged: boolean;
    nextParentId: string | null;
    requestedType: 'EXPENSE' | 'INCOME' | 'TRANSFER' | undefined;
  }): 'EXPENSE' | 'INCOME' | undefined {
    if (!typeChanged || nextParentId) {
      return undefined;
    }
    if (requestedType === 'EXPENSE' || requestedType === 'INCOME') {
      return requestedType;
    }
    return undefined;
  }
}
