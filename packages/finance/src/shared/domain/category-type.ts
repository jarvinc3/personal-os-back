export const FIN_CATEGORY_TYPES = ['EXPENSE', 'INCOME', 'TRANSFER'] as const;
export type FinCategoryTypeValue = (typeof FIN_CATEGORY_TYPES)[number];

export type CategoryResolveSource = 'hint' | 'merchant_history';

export type CategoryResolveResult = {
  categoryId: string | null;
  source: CategoryResolveSource | null;
};

export function categoryTypeForTransaction(
  type: 'DEBIT' | 'CREDIT' | 'TRANSFER',
): FinCategoryTypeValue | null {
  if (type === 'DEBIT') return 'EXPENSE';
  if (type === 'CREDIT') return 'INCOME';
  return null;
}

/** Lowercase, strip accents, collapse whitespace. */
export function normalizeCategoryLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function matchCategoryByHint(
  categories: Array<{ id: string; name: string; type: string }>,
  hint: string | null | undefined,
  transactionType: 'DEBIT' | 'CREDIT' | 'TRANSFER',
): string | null {
  if (!hint) return null;
  const expected = categoryTypeForTransaction(transactionType);
  if (!expected) return null;
  const needle = normalizeCategoryLabel(hint);
  if (!needle) return null;

  const typed = categories.filter((c) => c.type === expected);
  const exact = typed.find((c) => normalizeCategoryLabel(c.name) === needle);
  if (exact) return exact.id;

  const partial = typed.filter((c) => {
    const name = normalizeCategoryLabel(c.name);
    return name.includes(needle) || needle.includes(name);
  });
  return partial.length === 1 ? partial[0].id : null;
}

/**
 * Resolve category for an email import: LLM hint first, then merchant history.
 */
export async function resolveCategoryIdForImport(params: {
  categories: Array<{ id: string; name: string; type: string }>;
  hint: string | null | undefined;
  transactionType: 'DEBIT' | 'CREDIT' | 'TRANSFER';
  merchant: string | null | undefined;
  findCategoryIdByMerchant: (merchant: string) => Promise<string | null>;
}): Promise<CategoryResolveResult> {
  const fromHint = matchCategoryByHint(
    params.categories,
    params.hint,
    params.transactionType,
  );
  if (fromHint) {
    return { categoryId: fromHint, source: 'hint' };
  }

  const merchant = params.merchant?.trim();
  if (!merchant) {
    return { categoryId: null, source: null };
  }

  const expected = categoryTypeForTransaction(params.transactionType);
  if (!expected) {
    return { categoryId: null, source: null };
  }

  const fromHistory = await params.findCategoryIdByMerchant(merchant);
  if (!fromHistory) {
    return { categoryId: null, source: null };
  }

  const allowed = params.categories.some(
    (c) => c.id === fromHistory && c.type === expected,
  );
  if (!allowed) {
    return { categoryId: null, source: null };
  }

  return { categoryId: fromHistory, source: 'merchant_history' };
}
