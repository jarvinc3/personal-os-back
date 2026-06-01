/** Keep in sync with personal-os-app/modules/finance/constants/category-emoji.constants.ts */
export const LUCIDE_KEY_TO_EMOJI: Record<string, string> = {
  tag: '🏷️',
  cart: '🛒',
  home: '🏠',
  car: '🚗',
  food: '🍽️',
  coffee: '☕',
  heart: '💊',
  gift: '🎁',
};

export function normalizeLegacyCategoryIcon(icon: string | null | undefined): string | null {
  if (!icon?.trim()) return null;
  const trimmed = icon.trim();
  return LUCIDE_KEY_TO_EMOJI[trimmed] ?? null;
}
