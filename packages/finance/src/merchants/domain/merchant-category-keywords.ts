import { normalizeCategoryLabel } from '../../shared/domain/category-type';
import { normalizeMerchant } from './normalize-merchant';

/**
 * Words that identify a category without asking the user. Only explicit words
 * are listed: ambiguous brands (a subscription, ads or storage under the same
 * name) stay uncategorized on purpose, and nothing is guessed for them.
 */
const KEYWORD_RULES: ReadonlyArray<{
  keywords: readonly string[];
  categoryNames: readonly string[];
}> = [
  {
    keywords: ['SUPERMERCADO', 'SUPERMERCADOS', 'COLMADO', 'SUPER'],
    categoryNames: ['Supermercado', 'Alimentación', 'Comida', 'Mercado'],
  },
  {
    keywords: ['RESTAURANTE', 'RESTAURANT', 'PIZZA', 'BURGER', 'CAFE'],
    categoryNames: ['Restaurante', 'Restaurantes', 'Comida', 'Alimentación'],
  },
  {
    keywords: ['CINE', 'CINEMA', 'CINES'],
    categoryNames: ['Cine', 'Entretenimiento', 'Ocio'],
  },
  {
    keywords: ['FARMACIA', 'FARMACIAS', 'BOTICA', 'CLINICA', 'HOSPITAL'],
    categoryNames: ['Farmacia', 'Salud'],
  },
  {
    keywords: ['GASOLINA', 'COMBUSTIBLE', 'ESTACION'],
    categoryNames: ['Gasolina', 'Combustible', 'Transporte'],
  },
  {
    keywords: ['TRANSPORTE', 'TAXI', 'METRO'],
    categoryNames: ['Transporte'],
  },
];

type VisibleCategory = { id: string; name: string; type: string };

/**
 * Category that matches the merchant name by keyword, or null. Only a category
 * the user can already see is returned; nothing is created. The movement type
 * narrows the candidates, because a merchant category only suggests within its
 * own type.
 */
export function matchCategoryByKeyword(input: {
  merchantName: string;
  categories: readonly VisibleCategory[];
  categoryType: 'EXPENSE' | 'INCOME';
}): string | null {
  const key = normalizeMerchant(input.merchantName);
  if (!key) {
    return null;
  }
  const words = key.split(' ');
  for (const rule of KEYWORD_RULES) {
    if (!rule.keywords.some((keyword) => words.includes(keyword))) {
      continue;
    }
    const category = input.categories.find(
      (candidate) =>
        candidate.type === input.categoryType &&
        rule.categoryNames.some(
          (name) =>
            normalizeCategoryLabel(candidate.name) ===
            normalizeCategoryLabel(name),
        ),
    );
    if (category) {
      return category.id;
    }
  }
  return null;
}
