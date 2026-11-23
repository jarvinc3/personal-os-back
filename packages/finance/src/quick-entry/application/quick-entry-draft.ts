import type { QuickEntryExtraction } from './ports/quick-entry-extractor.port';
import {
  resolveAccount,
  resolveCard,
  resolveCategory,
} from './quick-entry-matchers';
import type {
  CatalogAccount,
  CatalogCard,
  CatalogCategory,
} from './quick-entry-types';

export type QuickEntryDraft = {
  type: 'DEBIT' | 'CREDIT';
  amount: string;
  currency: string;
  categoryId: string | null;
  accountId: string | null;
  cardId: string | null;
  date: string;
  merchant: string | null;
  description: string | null;
};

export type QuickEntryParseResult = {
  draft: QuickEntryDraft;
  confidence: number;
  missing: string[];
};

export function todayIso(timezone: string | null, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone ?? 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function resolveDate(value: string | null, timezone: string | null): string {
  if (value) {
    return value;
  }
  return todayIso(timezone, new Date());
}

function findMissing(draft: QuickEntryDraft): string[] {
  const missing: string[] = [];
  if (Number(draft.amount) <= 0) {
    missing.push('amount');
  }
  if (!draft.accountId && !draft.cardId) {
    missing.push('accountId');
  }
  return missing;
}

export function buildDraft(input: {
  extraction: QuickEntryExtraction;
  accounts: CatalogAccount[];
  cards: CatalogCard[];
  categories: CatalogCategory[];
  text: string;
  timezone: string | null;
}): QuickEntryParseResult {
  const { extraction, accounts, cards, categories, text, timezone } = input;
  const account = resolveAccount(extraction.accountHint, accounts);
  const card = resolveCard(extraction.cardHint, cards);
  const category = resolveCategory({
    hint: extraction.categoryNameHint,
    categories,
    type: extraction.type,
    text,
  });

  let accountId: string | null = null;
  let cardId: string | null = null;
  if (account) {
    accountId = account.id;
  } else if (card) {
    cardId = card.id;
  }

  const draft: QuickEntryDraft = {
    type: extraction.type,
    amount: extraction.amount,
    currency: extraction.currency,
    categoryId: category?.id ?? null,
    accountId,
    cardId,
    date: resolveDate(extraction.date, timezone),
    merchant: extraction.merchant,
    description: extraction.description,
  };

  return {
    draft,
    confidence: extraction.confidence,
    missing: findMissing(draft),
  };
}
