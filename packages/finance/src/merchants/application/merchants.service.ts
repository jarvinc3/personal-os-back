import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { clampPageLimit, decodeCursor, toCursorPage } from '@personal-os/core';
import { Prisma } from '@personal-os/database';
import { LogoService, type LogoUploadFile } from '@personal-os/logos';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { decimalToString } from '../../shared/domain/mappers';
import { categoryTypeForTransaction } from '../../shared/domain/category-type';
import { normalizeAliasList } from '../domain/merchant-aliases';
import { matchCategoryByKeyword } from '../domain/merchant-category-keywords';
import {
  canLearnCategory,
  MERCHANT_CATEGORY_SOURCE,
  type MerchantCategorySource,
} from '../domain/merchant-category-source';
import {
  merchantDisplayName,
  normalizeMerchant,
} from '../domain/normalize-merchant';
import {
  MerchantsRepository,
  type MerchantSpend,
} from '../infrastructure/merchants.repository';
import type { CreateMerchantDto } from '../presentation/dto/create-merchant.dto';
import type { ListMerchantsQueryDto } from '../presentation/dto/list-merchants-query.dto';
import type { UpdateMerchantDto } from '../presentation/dto/update-merchant.dto';

export type ResolvedMerchant = {
  id: string;
  name: string;
  normalizedKey: string;
  categoryId: string | null;
};

type MerchantRow = {
  id: string;
  name: string;
  normalizedKey: string;
  aliases: string[];
  categoryId: string | null;
  categorySource?: MerchantCategorySource | null;
  logoUrl: string | null;
  createdAt: Date;
};

type CategoryState = {
  categoryId: string | null;
  categorySource: MerchantCategorySource | null;
};

/** What a movement knows about the merchant it is linking to. */
export type ResolveMerchantInput = {
  userId: string;
  rawName: string | null | undefined;
  /** Category of the movement, learned by the merchant. */
  categoryId?: string | null;
  transactionType?: 'DEBIT' | 'CREDIT' | 'TRANSFER';
};

/** The `dateTo` bound is a calendar day, so it must cover the whole day. */
function endOfDay(value: string): Date {
  const date = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

function monthRange(query: { dateFrom?: string; dateTo?: string }, now: Date) {
  if (query.dateFrom && query.dateTo) {
    return { from: new Date(query.dateFrom), to: endOfDay(query.dateTo) };
  }
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0),
  );
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59),
  );
  return { from, to };
}

function mapMerchant(row: MerchantRow, spend: MerchantSpend | undefined) {
  return {
    id: row.id,
    name: row.name,
    normalizedKey: row.normalizedKey,
    aliases: row.aliases,
    categoryId: row.categoryId,
    categorySource: row.categorySource ?? null,
    logoUrl: row.logoUrl,
    createdAt: row.createdAt.toISOString(),
    monthSpend: decimalToString(spend?.spend ?? 0),
    monthMovements: spend?.movements ?? 0,
  };
}

const MAX_MERCHANT_NAME_LENGTH = 120;

/** Typed text is kept as written; bank descriptors get a clean display name. */
function visibleMerchantName(input: {
  displayName?: string | null;
  rawName: string | null | undefined;
  normalizedKey: string;
}): string {
  const typed = input.displayName?.replace(/\s+/g, ' ').trim();
  if (typed) {
    return typed.slice(0, MAX_MERCHANT_NAME_LENGTH);
  }
  return merchantDisplayName(input.rawName) ?? input.normalizedKey;
}

@Injectable()
export class MerchantsService {
  constructor(
    private readonly repo: MerchantsRepository,
    private readonly ownership: FinanceOwnershipService,
    private readonly logos: LogoService,
  ) {}

  async list(userId: string, query: ListMerchantsQueryDto, now = new Date()) {
    const limit = clampPageLimit(query.limit);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.repo.listMerchants(userId, {
      cursor,
      take: limit + 1,
      search: query.search,
    });
    const page = toCursorPage(rows, limit, (row) =>
      row.createdAt.toISOString(),
    );
    const spends = await this.repo.sumSpendByMerchant(
      userId,
      page.items.map((row) => row.id),
      monthRange(query, now),
    );
    const spendByMerchant = new Map(
      spends.map((spend) => [spend.merchantId, spend] as const),
    );
    return {
      ...page,
      items: page.items.map((row) =>
        mapMerchant(row, spendByMerchant.get(row.id)),
      ),
    };
  }

  async get(userId: string, id: string, now = new Date()) {
    const merchant = await this.repo.findMerchantById(userId, id);
    if (!merchant) {
      throw new NotFoundException('Comercio no encontrado');
    }
    const spends = await this.repo.sumSpendByMerchant(
      userId,
      [id],
      monthRange({}, now),
    );
    return mapMerchant(merchant, spends[0]);
  }

  /** Merchants with the same shape as `get`, in batch and without throwing. */
  async lookupMerchants(
    userId: string,
    ids: readonly string[],
    now = new Date(),
  ) {
    const rows = await this.repo.findMerchantsByIds(userId, ids);
    const spends = await this.repo.sumSpendByMerchant(
      userId,
      rows.map((row) => row.id),
      monthRange({}, now),
    );
    const spendByMerchant = new Map(
      spends.map((spend) => [spend.merchantId, spend] as const),
    );
    return new Map(
      rows.map((row) => [
        row.id,
        mapMerchant(row, spendByMerchant.get(row.id)),
      ]),
    );
  }

  async create(userId: string, dto: CreateMerchantDto, now = new Date()) {
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
      : await this.guessCategory(userId, { name });
    try {
      const created = await this.repo.createMerchant(userId, {
        name,
        normalizedKey,
        aliases: normalizeAliasList(dto.aliases ?? []),
        ...initialCategory,
      });
      return this.get(userId, created.id, now);
    } catch (error) {
      await this.throwNameConflict(error, userId, normalizedKey);
    }
  }

  async update(userId: string, id: string, dto: UpdateMerchantDto) {
    const existing = await this.repo.findMerchantById(userId, id);
    if (!existing) {
      throw new NotFoundException('Comercio no encontrado');
    }
    if (dto.categoryId !== undefined && dto.categoryId !== null) {
      await this.ownership.assertCategoryVisible(userId, dto.categoryId);
    }
    const changes: {
      name?: string;
      normalizedKey?: string;
      categoryId?: string | null;
      categorySource?: MerchantCategorySource | null;
      logoUrl?: string | null;
    } = {};
    if (dto.name !== undefined) {
      const normalizedKey = normalizeMerchant(dto.name);
      if (!normalizedKey) {
        throw new BadRequestException(
          'El nombre del comercio no tiene texto utilizable',
        );
      }
      changes.name = dto.name.trim();
      changes.normalizedKey = normalizedKey;
    }
    if (dto.categoryId !== undefined) {
      // Sending the category, even the same one, is the user confirming it.
      changes.categoryId = dto.categoryId;
      changes.categorySource = dto.categoryId
        ? MERCHANT_CATEGORY_SOURCE.MANUAL
        : null;
    }
    if (dto.logoUrl !== undefined) {
      changes.logoUrl = dto.logoUrl?.trim() || null;
    }
    try {
      await this.repo.updateMerchant(userId, id, changes);
    } catch (error) {
      await this.throwNameConflict(
        error,
        userId,
        changes.normalizedKey ?? existing.normalizedKey,
      );
    }
    return this.get(userId, id);
  }

  async merge(userId: string, id: string, targetId: string, now = new Date()) {
    if (id === targetId) {
      throw new BadRequestException(
        'No se puede fusionar un comercio consigo mismo',
      );
    }
    const merged = await this.repo.mergeMerchants(userId, id, targetId);
    if (!merged) {
      throw new NotFoundException('Comercio no encontrado');
    }
    return this.get(userId, targetId, now);
  }

  async uploadLogo(
    userId: string,
    id: string,
    file: LogoUploadFile | undefined,
    now = new Date(),
  ) {
    if (!file) {
      throw new BadRequestException('Archivo obligatorio');
    }
    const existing = await this.repo.findMerchantById(userId, id);
    if (!existing) {
      throw new NotFoundException('Comercio no encontrado');
    }
    let url: string | null;
    try {
      const path = await this.logos.saveCustomLogo(userId, id, file);
      url = this.logos.publicUrl(path);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'No se pudo guardar el logo',
      );
    }
    await this.repo.updateMerchant(userId, id, { logoUrl: url });
    return this.get(userId, id, now);
  }

  /** Resolves (creating when needed) the canonical merchant for raw text. */
  resolve(input: ResolveMerchantInput) {
    return this.resolveMerchant(input);
  }

  /** Resolves text the user typed, keeping its capitalisation as the name. */
  resolveTyped(input: ResolveMerchantInput) {
    return this.resolveMerchant({ ...input, displayName: input.rawName });
  }

  /**
   * Finds or creates the merchant for a text, then keeps what the movement
   * teaches: the category it carries and the text it appeared with.
   */
  private async resolveMerchant({
    userId,
    rawName,
    categoryId,
    transactionType,
    displayName,
  }: ResolveMerchantInput & {
    displayName?: string | null;
  }): Promise<ResolvedMerchant | null> {
    const normalizedKey = normalizeMerchant(rawName);
    if (!normalizedKey) {
      return null;
    }
    const existing = await this.repo.findMerchantByKey(userId, normalizedKey);
    if (existing) {
      await this.appendAlias(userId, existing.id, existing.aliases, rawName);
      const learned = await this.learnCategory(userId, existing, categoryId);
      return this.toResolved({ ...existing, ...learned });
    }
    const name = visibleMerchantName({
      displayName,
      rawName,
      normalizedKey,
    });
    const initialCategory = categoryId
      ? {
          categoryId,
          categorySource: MERCHANT_CATEGORY_SOURCE.LEARNED,
        }
      : await this.guessCategory(userId, { name, transactionType });
    try {
      const created = await this.repo.createMerchant(userId, {
        name,
        normalizedKey,
        aliases: rawName ? [rawName] : [],
        ...initialCategory,
      });
      return this.toResolved(created);
    } catch (error) {
      return this.reuseOrThrow(error, {
        userId,
        normalizedKey,
        categoryId,
      });
    }
  }

  /** Best existing merchant for a typed name, to suggest its category. */
  async suggest(userId: string, rawName: string | null | undefined) {
    const normalizedKey = normalizeMerchant(rawName);
    if (!normalizedKey) {
      return null;
    }
    const exact = await this.repo.findMerchantByKey(userId, normalizedKey);
    const candidate =
      exact ?? (await this.repo.findMerchantByKeyPrefix(userId, normalizedKey));
    if (!candidate) {
      return null;
    }
    return {
      merchantId: candidate.id,
      name: candidate.name,
      categoryId: candidate.categoryId,
      categorySource: candidate.categorySource ?? null,
    };
  }

  /**
   * The category a movement brought. It fills an empty merchant and replaces a
   * keyword guess; a manual one, or one already learned, stays as it is.
   */
  private async learnCategory(
    userId: string,
    merchant: MerchantRow,
    categoryId: string | null | undefined,
  ): Promise<CategoryState> {
    const state: CategoryState = {
      categoryId: merchant.categoryId,
      categorySource: merchant.categorySource ?? null,
    };
    if (!categoryId || !canLearnCategory(state)) {
      return state;
    }
    await this.repo.updateMerchant(userId, merchant.id, {
      categoryId,
      categorySource: MERCHANT_CATEGORY_SOURCE.LEARNED,
    });
    return {
      categoryId,
      categorySource: MERCHANT_CATEGORY_SOURCE.LEARNED,
    };
  }

  /** A keyword guess only fills a merchant that has no category yet. */
  private async guessCategory(
    userId: string,
    input: {
      name: string;
      transactionType?: 'DEBIT' | 'CREDIT' | 'TRANSFER';
    },
  ): Promise<CategoryState> {
    const categoryType = input.transactionType
      ? categoryTypeForTransaction(input.transactionType)
      : 'EXPENSE';
    if (categoryType !== 'EXPENSE' && categoryType !== 'INCOME') {
      return { categoryId: null, categorySource: null };
    }
    const categories = await this.repo.listVisibleCategories(userId);
    const categoryId = matchCategoryByKeyword({
      merchantName: input.name,
      categories,
      categoryType,
    });
    if (!categoryId) {
      return { categoryId: null, categorySource: null };
    }
    return {
      categoryId,
      categorySource: MERCHANT_CATEGORY_SOURCE.KEYWORD,
    };
  }

  /**
   * Two requests may create the same merchant at once: the second one reuses
   * the row the first one wrote instead of failing the movement.
   */
  private async reuseOrThrow(
    error: unknown,
    input: {
      userId: string;
      normalizedKey: string;
      categoryId?: string | null;
    },
  ): Promise<ResolvedMerchant> {
    if (!(
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    )) {
      throw error;
    }
    const existing = await this.repo.findMerchantByKey(
      input.userId,
      input.normalizedKey,
    );
    if (!existing) {
      throw error;
    }
    const learned = await this.learnCategory(
      input.userId,
      existing,
      input.categoryId,
    );
    return this.toResolved({ ...existing, ...learned });
  }

  private toResolved(row: {
    id: string;
    name: string;
    normalizedKey: string;
    categoryId: string | null;
  }): ResolvedMerchant {
    return {
      id: row.id,
      name: row.name,
      normalizedKey: row.normalizedKey,
      categoryId: row.categoryId,
    };
  }

  private async appendAlias(
    userId: string,
    id: string,
    aliases: string[],
    rawName: string | null | undefined,
  ): Promise<void> {
    if (!rawName || aliases.includes(rawName)) {
      return;
    }
    await this.repo.updateMerchant(userId, id, {
      aliases: [...aliases, rawName],
    });
  }

  /** 409 with the merchant that already holds the key, so the web can open it. */
  private async throwNameConflict(
    error: unknown,
    userId: string,
    normalizedKey: string,
  ): Promise<never> {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existing = await this.repo.findMerchantByKey(userId, normalizedKey);
      throw new ConflictException({
        message: 'Ya existe un comercio con ese nombre',
        existingMerchantId: existing?.id ?? null,
      });
    }
    throw error;
  }
}
