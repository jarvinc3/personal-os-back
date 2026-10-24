import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { clampPageLimit, decodeCursor, toCursorPage } from '@personal-os/core';
import { Prisma } from '@personal-os/database';
import {
  LogoService,
  normalizeDomain,
  type LogoUploadFile,
} from '@personal-os/logos';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { decimalToString } from '../../shared/domain/mappers';
import { categoryTypeForTransaction } from '../../shared/domain/category-type';
import {
  aliasNormalizedKey,
  MAX_MERCHANT_ALIASES,
  normalizeAliasList,
} from '../domain/merchant-aliases';
import { matchCategoryByKeyword } from '../domain/merchant-category-keywords';
import {
  countPossibleDuplicates,
  findDuplicateCandidates,
} from '../domain/merchant-duplicates';
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
  aliases: Array<{ alias: string }>;
  categoryId: string | null;
  categorySource?: MerchantCategorySource | null;
  domain?: string | null;
  logoPath?: string | null;
  customLogoPath?: string | null;
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

function mapMerchant(
  row: MerchantRow,
  spend: MerchantSpend | undefined,
  logos: LogoService,
) {
  return {
    id: row.id,
    name: row.name,
    normalizedKey: row.normalizedKey,
    aliases: row.aliases.map((entry) => entry.alias),
    categoryId: row.categoryId,
    categorySource: row.categorySource ?? null,
    domain: row.domain ?? null,
    logoUrl: logos.resolveUrl(row),
    createdAt: row.createdAt.toISOString(),
    monthSpend: decimalToString(spend?.spend ?? 0),
    monthMovements: spend?.movements ?? 0,
  };
}

const MAX_MERCHANT_NAME_LENGTH = 120;
const DUPLICATE_CANDIDATE_LIMIT = 5;

/** Duplicate detection reads plain alias texts, not the relation rows. */
function comparable(row: {
  id: string;
  name: string;
  normalizedKey: string;
  logoUrl: string | null;
  aliases: Array<{ alias: string }>;
}) {
  return {
    id: row.id,
    name: row.name,
    normalizedKey: row.normalizedKey,
    logoUrl: row.logoUrl,
    aliases: row.aliases.map((entry) => entry.alias),
  };
}

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
    const comparables = (await this.repo.listMerchantComparables(userId)).map(
      comparable,
    );
    const dismissed = await this.dismissedByMerchant(userId);
    return {
      ...page,
      items: page.items.map((row) => ({
        ...mapMerchant(row, spendByMerchant.get(row.id), this.logos),
        possibleDuplicates: countPossibleDuplicates(
          comparable(row),
          comparables,
          dismissed.get(row.id) ?? new Set<string>(),
        ),
      })),
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
    return mapMerchant(merchant, spends[0], this.logos);
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
        mapMerchant(row, spendByMerchant.get(row.id), this.logos),
      ]),
    );
  }

  /**
   * Up to five merchants that look like this one, with the reason. The new
   * normalization is computed here, so merchants stored before it still get
   * candidates without recalculating anything.
   */
  async duplicates(userId: string, id: string, now = new Date()) {
    const target = await this.repo.findMerchantById(userId, id);
    if (!target) {
      throw new NotFoundException('Comercio no encontrado');
    }
    const dismissed = await this.dismissedByMerchant(userId);
    const dismissedForTarget = dismissed.get(id) ?? new Set<string>();
    const others = (await this.repo.listMerchantComparables(userId))
      .filter((row) => row.id !== id && !dismissedForTarget.has(row.id))
      .map(comparable);
    const candidates = findDuplicateCandidates(
      comparable(target),
      others,
      DUPLICATE_CANDIDATE_LIMIT,
    );
    const spends = await this.repo.sumSpendByMerchant(
      userId,
      candidates.map((candidate) => candidate.merchant.id),
      monthRange({}, now),
    );
    const spendByMerchant = new Map(
      spends.map((spend) => [spend.merchantId, spend] as const),
    );
    return candidates.map(({ merchant, reason }) => ({
      id: merchant.id,
      name: merchant.name,
      logoUrl: merchant.logoUrl,
      monthSpend: decimalToString(spendByMerchant.get(merchant.id)?.spend ?? 0),
      monthMovements: spendByMerchant.get(merchant.id)?.movements ?? 0,
      reason,
    }));
  }

  /** Marks a pair as "not a duplicate"; repeating it changes nothing. */
  async dismissDuplicate(userId: string, id: string, otherId: string) {
    const pair = await this.requireDismissiblePair(userId, id, otherId);
    await this.repo.dismissPair(userId, pair.merchantId, pair.otherMerchantId);
    return { dismissed: true };
  }

  /** Undoes a dismissal, so the pair can be suggested again. */
  async undoDismissDuplicate(userId: string, id: string, otherId: string) {
    const pair = await this.requireDismissiblePair(userId, id, otherId);
    await this.repo.undoDismissPair(
      userId,
      pair.merchantId,
      pair.otherMerchantId,
    );
    return { dismissed: false };
  }

  /**
   * Both merchants must belong to the user, and the pair is stored in
   * canonical order, so A-B and B-A are the same record.
   */
  private async requireDismissiblePair(
    userId: string,
    id: string,
    otherId: string,
  ): Promise<{ merchantId: string; otherMerchantId: string }> {
    if (id === otherId) {
      throw new BadRequestException(
        'No se puede descartar un comercio consigo mismo',
      );
    }
    const [merchant, other] = await Promise.all([
      this.repo.findMerchantById(userId, id),
      this.repo.findMerchantById(userId, otherId),
    ]);
    if (!merchant || !other) {
      throw new NotFoundException('Comercio no encontrado');
    }
    return merchant.id < other.id
      ? { merchantId: merchant.id, otherMerchantId: other.id }
      : { merchantId: other.id, otherMerchantId: merchant.id };
  }

  /** Dismissed partners of every merchant, for the count on the list. */
  private async dismissedByMerchant(
    userId: string,
  ): Promise<Map<string, Set<string>>> {
    const pairs = await this.repo.listDismissedPairs(userId);
    const byMerchant = new Map<string, Set<string>>();
    const add = (merchantId: string, partnerId: string) => {
      const partners = byMerchant.get(merchantId) ?? new Set<string>();
      partners.add(partnerId);
      byMerchant.set(merchantId, partners);
    };
    for (const pair of pairs) {
      add(pair.merchantId, pair.otherMerchantId);
      add(pair.otherMerchantId, pair.merchantId);
    }
    return byMerchant;
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
    const aliases = normalizeAliasList(dto.aliases ?? []);
    await this.assertAliasesFree(userId, aliases);
    const domain = await this.resolveLogoDomain(dto.domain);
    try {
      const created = await this.repo.createMerchant(userId, {
        name,
        normalizedKey,
        aliases,
        ...initialCategory,
        domain: domain.domain,
        logoPath: domain.logoPath,
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
      domain?: string | null;
      logoPath?: string | null;
      customLogoPath?: string | null;
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
    const previousCustomLogoPath =
      dto.domain !== undefined ? existing.customLogoPath : null;
    if (dto.domain !== undefined) {
      const domain = await this.resolveLogoDomain(dto.domain);
      changes.domain = domain.domain;
      changes.logoPath = domain.logoPath;
      // Choosing a brand replaces the own upload, which would hide it.
      changes.customLogoPath = null;
    }
    const aliases =
      dto.aliases === undefined ? null : normalizeAliasList(dto.aliases);
    if (aliases) {
      await this.assertAliasesFree(userId, aliases, id);
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
    if (aliases) {
      await this.repo.replaceAliases(userId, id, aliases);
    }
    if (previousCustomLogoPath) {
      await this.logos.deleteCustomLogo(previousCustomLogoPath);
    }
    if (
      changes.normalizedKey &&
      changes.normalizedKey !== existing.normalizedKey
    ) {
      // The previous name must keep pointing at the same merchant.
      await this.appendAlias(userId, existing, existing.name);
    }
    return this.get(userId, id);
  }

  async merge(userId: string, id: string, targetId: string, now = new Date()) {
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
      await this.logos.deleteCustomLogo(source.customLogoPath);
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
    let path: string;
    try {
      path = await this.logos.saveCustomLogo(userId, id, file);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'No se pudo guardar el logo',
      );
    }
    await this.repo.updateMerchant(userId, id, { customLogoPath: path });
    return this.get(userId, id, now);
  }

  /** Removes the own upload, so the brand logo can show again. */
  async deleteLogo(userId: string, id: string, now = new Date()) {
    const existing = await this.repo.findMerchantById(userId, id);
    if (!existing) {
      throw new NotFoundException('Comercio no encontrado');
    }
    await this.repo.updateMerchant(userId, id, { customLogoPath: null });
    if (existing.customLogoPath) {
      await this.logos.deleteCustomLogo(existing.customLogoPath);
    }
    return this.get(userId, id, now);
  }

  /** Normalizes the domain and ensures its brand file, like institutions do. */
  private async resolveLogoDomain(
    rawDomain: string | null | undefined,
  ): Promise<{ domain: string | null; logoPath: string | null }> {
    if (rawDomain == null || rawDomain.trim() === '') {
      return { domain: null, logoPath: null };
    }
    const domain = normalizeDomain(rawDomain);
    if (!domain) {
      throw new BadRequestException('Dominio inválido');
    }
    return { domain, logoPath: await this.logos.ensureLogo(domain) };
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
    const existing =
      (await this.repo.findMerchantByKey(userId, normalizedKey)) ??
      (await this.repo.findMerchantByAliasKey(userId, normalizedKey));
    if (existing) {
      await this.appendAlias(userId, existing, rawName);
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

  /**
   * Keeps the text that reached the merchant, without growing forever: a text
   * that already matches the name, the key or an alias adds nothing, and the
   * list stops at the maximum. A manual list replaces the whole thing, so it
   * always wins over the automatic one.
   */
  private async appendAlias(
    userId: string,
    merchant: MerchantRow,
    rawName: string | null | undefined,
  ): Promise<void> {
    const normalizedKey = normalizeMerchant(rawName);
    if (!rawName || !normalizedKey) {
      return;
    }
    if (normalizedKey === merchant.normalizedKey) {
      return;
    }
    const known = merchant.aliases.some(
      (entry) => aliasNormalizedKey(entry.alias) === normalizedKey,
    );
    if (known || merchant.aliases.length >= MAX_MERCHANT_ALIASES) {
      return;
    }
    await this.repo.addAlias(userId, merchant.id, rawName, normalizedKey);
  }

  /**
   * An alias cannot repeat another merchant's key or another merchant's alias:
   * a text must resolve to one merchant only.
   */
  private async assertAliasesFree(
    userId: string,
    aliases: readonly string[],
    ownId?: string,
  ): Promise<void> {
    const keys = aliases.flatMap((alias) => {
      const key = aliasNormalizedKey(alias);
      return key ? [key] : [];
    });
    const [byKey, byAlias] = await Promise.all([
      this.repo.findMerchantByKeys(userId, keys),
      this.repo.findMerchantByAliasKeys(userId, keys),
    ]);
    const holder = [byKey, byAlias].find(
      (candidate) => candidate !== null && candidate.id !== ownId,
    );
    if (!holder) {
      return;
    }
    throw new ConflictException({
      message: 'Ya existe un comercio con ese nombre',
      existingMerchantId: holder.id,
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
