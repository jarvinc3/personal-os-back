/**
 * Origin of a merchant category. Precedence: manual, then learned from a
 * movement, then guessed from a keyword. A lower origin never replaces a higher
 * one, and only a manual category is definitive.
 */
export const MERCHANT_CATEGORY_SOURCE = {
  MANUAL: 'MANUAL',
  LEARNED: 'LEARNED',
  KEYWORD: 'KEYWORD',
} as const;

export type MerchantCategorySource =
  (typeof MERCHANT_CATEGORY_SOURCE)[keyof typeof MERCHANT_CATEGORY_SOURCE];

type CategoryState = {
  categoryId: string | null;
  categorySource: MerchantCategorySource | null;
};

/** A learned category fills an empty one and replaces a keyword guess. */
export function canLearnCategory(state: CategoryState): boolean {
  if (state.categorySource === MERCHANT_CATEGORY_SOURCE.MANUAL) {
    return false;
  }
  return (
    state.categoryId === null ||
    state.categorySource === MERCHANT_CATEGORY_SOURCE.KEYWORD
  );
}
