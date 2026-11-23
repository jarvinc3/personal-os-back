import { ConflictException } from '@nestjs/common';
import { Prisma } from '@personal-os/database';
import { categoryTypeForTransaction } from '../../shared/domain/category-type';
import {
  aliasNormalizedKey,
  MAX_MERCHANT_ALIASES,
} from '../domain/merchant-aliases';
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
import type { MerchantsRepository } from '../infrastructure/merchants.repository';
import type { MerchantRow } from './merchant-view';

export type ResolvedMerchant = {
  id: string;
  name: string;
  normalizedKey: string;
  categoryId: string | null;
};

/** What a movement knows about the merchant it is linking to. */
export type ResolveMerchantInput = {
  userId: string;
  rawName: string | null | undefined;
  /** Category of the movement, learned by the merchant. */
  categoryId?: string | null;
  transactionType?: 'DEBIT' | 'CREDIT' | 'TRANSFER';
};

export type MerchantSuggestion = {
  merchantId: string;
  name: string;
  categoryId: string | null;
  categorySource: MerchantCategorySource | null;
};

type CategoryState = {
  categoryId: string | null;
  categorySource: MerchantCategorySource | null;
};

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

/** Recognizes merchants by key or alias, learns their category and suggests one. */
export class MerchantResolver {
  constructor(private readonly repo: MerchantsRepository) {}

  /** Resolves (creating when needed) the canonical merchant for raw text. */
  resolve(input: ResolveMerchantInput): Promise<ResolvedMerchant | null> {
    return this.resolveMerchant(input);
  }

  /** Resolves text the user typed, keeping its capitalisation as the name. */
  resolveTyped(input: ResolveMerchantInput): Promise<ResolvedMerchant | null> {
    return this.resolveMerchant({ ...input, displayName: input.rawName });
  }

  /** Best existing merchant for a typed name, to suggest its category. */
  async suggest(
    userId: string,
    rawName: string | null | undefined,
  ): Promise<MerchantSuggestion | null> {
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

  /** A keyword guess only fills a merchant that has no category yet. */
  async guessCategory(
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
   * Keeps the text that reached the merchant, without growing forever: a text
   * that already matches the name, the key or an alias adds nothing, and the
   * list stops at the maximum. A manual list replaces the whole thing, so it
   * always wins over the automatic one.
   */
  async appendAlias(
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
    await this.repo.addAlias({
      userId,
      merchantId: merchant.id,
      alias: rawName,
      normalizedKey,
    });
  }

  /**
   * An alias cannot repeat another merchant's key or another merchant's alias:
   * a text must resolve to one merchant only.
   */
  async assertAliasesFree(
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
  async throwNameConflict(
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
}
