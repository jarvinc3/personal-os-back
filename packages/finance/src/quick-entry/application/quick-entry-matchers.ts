import type {
  CatalogAccount,
  CatalogCard,
  CatalogCategory,
} from './quick-entry-types';

const PAYROLL_TEXT = /quincena|nomina|salario|sueldo/;
const PAYROLL_CATEGORY = /nomina|salario|sueldo|ingreso/;
const MIN_MATCH_DIGITS = 3;

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function digitsOf(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

function matchScore(input: {
  label: string;
  digits: string;
  hint: string;
  hintDigits: string;
}): number {
  const textMatch = input.label.includes(input.hint) ? 2 : 0;
  const digitMatch =
    input.hintDigits.length >= MIN_MATCH_DIGITS &&
    input.digits.endsWith(input.hintDigits)
      ? 3
      : 0;
  return textMatch + digitMatch;
}

export function resolveAccount(
  hint: string | null,
  accounts: CatalogAccount[],
): CatalogAccount | null {
  const needle = normalize(hint ?? '');
  if (!needle) {
    return null;
  }
  const hintDigits = digitsOf(hint);
  const scored = accounts
    .map((account) => {
      const label = normalize(
        [account.name, account.institutionName].filter(Boolean).join(' '),
      );
      return {
        account,
        score: matchScore({
          label,
          digits: digitsOf(account.accountNumberLast4),
          hint: needle,
          hintDigits,
        }),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.account ?? null;
}

export function resolveCard(
  hint: string | null,
  cards: CatalogCard[],
): CatalogCard | null {
  const needle = normalize(hint ?? '');
  if (!needle) {
    return null;
  }
  const hintDigits = digitsOf(hint);
  const scored = cards
    .map((card) => {
      const label = normalize(
        [card.name, card.network, card.institutionName]
          .filter(Boolean)
          .join(' '),
      );
      return {
        card,
        score: matchScore({
          label,
          digits: digitsOf(card.lastFour),
          hint: needle,
          hintDigits,
        }),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.card ?? null;
}

function categoryPool(
  categories: CatalogCategory[],
  type: 'DEBIT' | 'CREDIT',
): CatalogCategory[] {
  const expected = type === 'DEBIT' ? 'EXPENSE' : 'INCOME';
  return categories.filter((category) => category.type === expected);
}

export function resolveCategory(input: {
  hint: string | null;
  categories: CatalogCategory[];
  type: 'DEBIT' | 'CREDIT';
  text: string;
}): CatalogCategory | null {
  const { hint, categories, type, text } = input;
  const pool = categoryPool(categories, type);
  if (type === 'CREDIT' && PAYROLL_TEXT.test(normalize(text))) {
    const payroll = pool.find((category) =>
      PAYROLL_CATEGORY.test(normalize(category.name)),
    );
    if (payroll) {
      return payroll;
    }
  }
  const needle = normalize(hint ?? '');
  if (!needle) {
    return null;
  }
  const exact = pool.find((category) => normalize(category.name) === needle);
  if (exact) {
    return exact;
  }
  const partial = pool.filter((category) => {
    const name = normalize(category.name);
    return name.includes(needle) || needle.includes(name);
  });
  return partial[0] ?? null;
}
