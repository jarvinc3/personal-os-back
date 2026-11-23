import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { normalizeAliasList } from '../domain/merchant-aliases';
import { MERCHANT_CATEGORY_SOURCE } from '../domain/merchant-category-source';
import { normalizeMerchant } from '../domain/normalize-merchant';
import type { MerchantsRepository } from '../infrastructure/merchants.repository';
import type { CreateMerchantDto } from '../presentation/dto/create-merchant.dto';
import type { UpdateMerchantDto } from '../presentation/dto/update-merchant.dto';
import type { MerchantDirectory } from './merchant-directory';
import type { MerchantLogos } from './merchant-logos';
import type { MerchantResolver } from './merchant-resolver';
import {
  merchantCategoryChange,
  merchantNameChange,
  type MerchantUpdateChanges,
} from './merchant-update-changes';
import type { MerchantRow, MerchantView } from './merchant-view';

type MerchantWritesDeps = {
  repo: MerchantsRepository;
  ownership: FinanceOwnershipService;
  resolver: MerchantResolver;
  logos: MerchantLogos;
  directory: MerchantDirectory;
};

type PersistUpdateInput = {
  userId: string;
  id: string;
  existing: MerchantRow;
  changes: MerchantUpdateChanges;
};

type UpdateSideEffectsInput = PersistUpdateInput & {
  aliases: string[] | null;
  previousCustomLogoPath: string | null;
};

/** Create, edit and merge commands for merchants. */
export class MerchantWrites {
  private readonly repo: MerchantsRepository;
  private readonly ownership: FinanceOwnershipService;
  private readonly resolver: MerchantResolver;
  private readonly logos: MerchantLogos;
  private readonly directory: MerchantDirectory;

  constructor({
    repo,
    ownership,
    resolver,
    logos,
    directory,
  }: MerchantWritesDeps) {
    this.repo = repo;
    this.ownership = ownership;
    this.resolver = resolver;
    this.logos = logos;
    this.directory = directory;
  }

  async create(
    userId: string,
    dto: CreateMerchantDto,
    now = new Date(),
  ): Promise<MerchantView> {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException(
        'El nombre del comercio no tiene texto utilizable',
      );
    }
    const normalizedKey = normalizeMerchant(name);
    if (!normalizedKey) {
      throw new BadRequestException(
        'El nombre del comercio no tiene texto utilizable',
      );
    }
    if (dto.categoryId) {
      await this.ownership.assertCategoryVisible(userId, dto.categoryId);
    }
    const initialCategory = dto.categoryId
      ? {
          categoryId: dto.categoryId,
          categorySource: MERCHANT_CATEGORY_SOURCE.MANUAL,
        }
      : await this.resolver.guessCategory(userId, { name });
    const aliases = normalizeAliasList(dto.aliases ?? []);
    await this.resolver.assertAliasesFree(userId, aliases);
    const domain = await this.logos.resolveDomain(dto.domain);
    try {
      const created = await this.repo.createMerchant(userId, {
        name,
        normalizedKey,
        aliases,
        ...initialCategory,
        domain: domain.domain,
        logoPath: domain.logoPath,
      });
      return this.directory.get(userId, created.id, now);
    } catch (error) {
      return this.resolver.throwNameConflict(error, userId, normalizedKey);
    }
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateMerchantDto,
  ): Promise<MerchantView> {
    const existing = await this.requireMerchant(userId, id);
    if (dto.categoryId !== undefined && dto.categoryId !== null) {
      await this.ownership.assertCategoryVisible(userId, dto.categoryId);
    }
    const name = merchantNameChange(dto.name);
    const category = merchantCategoryChange(dto.categoryId);
    const domain = await this.resolveDomainChanges(dto.domain);
    const changes: MerchantUpdateChanges = {
      ...(name ?? {}),
      ...(category ?? {}),
      ...(domain ?? {}),
    };
    const aliases =
      dto.aliases === undefined ? null : normalizeAliasList(dto.aliases);
    const previousCustomLogoPath = domain
      ? (existing.customLogoPath ?? null)
      : null;
    if (aliases) {
      await this.resolver.assertAliasesFree(userId, aliases, id);
    }
    await this.persistUpdate({ userId, id, existing, changes });
    await this.applyUpdateSideEffects({
      userId,
      id,
      existing,
      changes,
      aliases,
      previousCustomLogoPath,
    });
    return this.directory.get(userId, id);
  }

  async merge(
    userId: string,
    id: string,
    targetId: string,
  ): Promise<MerchantView> {
    const now = new Date();
    if (id === targetId) {
      throw new BadRequestException(
        'No se puede fusionar un comercio consigo mismo',
      );
    }
    const [source, target] = await Promise.all([
      this.repo.findMerchantById(userId, id),
      this.repo.findMerchantById(userId, targetId),
    ]);
    const merged = await this.repo.mergeMerchants(userId, id, targetId);
    if (!merged) {
      throw new NotFoundException('Comercio no encontrado');
    }
    // The target kept its own upload, so the source file would be orphaned.
    if (source?.customLogoPath && target?.customLogoPath) {
      await this.logos.removeCustomLogo(source.customLogoPath);
    }
    return this.directory.get(userId, targetId, now);
  }

  private async requireMerchant(
    userId: string,
    id: string,
  ): Promise<MerchantRow> {
    const merchant = await this.repo.findMerchantById(userId, id);
    if (!merchant) {
      throw new NotFoundException('Comercio no encontrado');
    }
    return merchant;
  }

  private async resolveDomainChanges(
    domain: string | null | undefined,
  ): Promise<MerchantUpdateChanges | null> {
    if (domain === undefined) {
      return null;
    }
    const resolved = await this.logos.resolveDomain(domain);
    return {
      domain: resolved.domain,
      logoPath: resolved.logoPath,
      // Choosing a brand replaces the own upload, which would hide it.
      customLogoPath: null,
    };
  }

  private async persistUpdate(input: PersistUpdateInput): Promise<void> {
    try {
      await this.repo.updateMerchant(input.userId, input.id, input.changes);
    } catch (error) {
      await this.resolver.throwNameConflict(
        error,
        input.userId,
        input.changes.normalizedKey ?? input.existing.normalizedKey,
      );
    }
  }

  private async applyUpdateSideEffects(
    input: UpdateSideEffectsInput,
  ): Promise<void> {
    if (input.aliases) {
      await this.repo.replaceAliases(input.userId, input.id, input.aliases);
    }
    if (input.previousCustomLogoPath) {
      await this.logos.removeCustomLogo(input.previousCustomLogoPath);
    }
    if (
      input.changes.normalizedKey &&
      input.changes.normalizedKey !== input.existing.normalizedKey
    ) {
      // The previous name must keep pointing at the same merchant.
      await this.resolver.appendAlias(
        input.userId,
        input.existing,
        input.existing.name,
      );
    }
  }
}
