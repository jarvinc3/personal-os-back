import type { LogoService } from '@personal-os/logos';
import { decimalToString } from '../../shared/domain/mappers';
import type { MerchantCategorySource } from '../domain/merchant-category-source';
import type { MerchantSpend } from '../infrastructure/merchant-queries';

export type MerchantRow = {
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

export type MerchantView = {
  id: string;
  name: string;
  normalizedKey: string;
  aliases: string[];
  categoryId: string | null;
  categorySource: MerchantCategorySource | null;
  domain: string | null;
  logoUrl: string | null;
  createdAt: string;
  monthSpend: string;
  monthMovements: number;
};

export type MerchantListItemView = MerchantView & {
  possibleDuplicates: number;
};

export type MerchantPageView = {
  items: MerchantListItemView[];
  hasMore: boolean;
  nextCursor: string | null;
};

export type MerchantComparable = {
  id: string;
  name: string;
  normalizedKey: string;
  logoUrl: string | null;
  aliases: string[];
};

export type MerchantDuplicateView = {
  id: string;
  name: string;
  logoUrl: string | null;
  monthSpend: string;
  monthMovements: number;
  reason: string;
};

export type MerchantMonthRange = {
  from: Date;
  to: Date;
};

export const DUPLICATE_CANDIDATE_LIMIT = 5;

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The `dateTo` bound is a calendar day, so it must cover the whole day. */
function endOfDay(value: string): Date {
  const date = new Date(value);
  if (CALENDAR_DAY.test(value)) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

export function merchantMonthRange(
  query: { dateFrom?: string; dateTo?: string },
  now: Date,
): MerchantMonthRange {
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

export function toMerchantView(
  row: MerchantRow,
  spend: MerchantSpend | undefined,
  logos: LogoService,
): MerchantView {
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

/** Duplicate detection reads plain alias texts, not the relation rows. */
export function comparableMerchant(row: {
  id: string;
  name: string;
  normalizedKey: string;
  logoUrl: string | null;
  aliases: Array<{ alias: string }>;
}): MerchantComparable {
  return {
    id: row.id,
    name: row.name,
    normalizedKey: row.normalizedKey,
    logoUrl: row.logoUrl,
    aliases: row.aliases.map((entry) => entry.alias),
  };
}
