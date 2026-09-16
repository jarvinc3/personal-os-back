export const FIN_CATEGORY_TYPES = ['EXPENSE', 'INCOME'] as const;
export type FinCategoryTypeValue = (typeof FIN_CATEGORY_TYPES)[number];

export function categoryTypeForTransaction(
  type: 'DEBIT' | 'CREDIT' | 'TRANSFER',
): FinCategoryTypeValue | null {
  if (type === 'DEBIT') return 'EXPENSE';
  if (type === 'CREDIT') return 'INCOME';
  return null;
}

export function matchCategoryByHint(
  categories: Array<{ id: string; name: string; type: string }>,
  hint: string | null | undefined,
  transactionType: 'DEBIT' | 'CREDIT' | 'TRANSFER',
): string | null {
  if (!hint) return null;
  const expected = categoryTypeForTransaction(transactionType);
  if (!expected) return null;
  const needle = hint.toLowerCase();
  return (
    categories.find(
      (c) => c.type === expected && c.name.toLowerCase() === needle,
    )?.id ?? null
  );
}
