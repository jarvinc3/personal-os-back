import type { StatementImportCategory } from '../infrastructure/statement-imports.repository';
import type { StatementLineType } from './statement-line-matching';
import { statementTypeMatchesCategory } from './statement-import-view';

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The extractor only suggests a category name; the id must exist among the
 * user's own categories and match the movement direction.
 */
export function resolveStatementCategoryId({
  categories,
  hint,
  type,
}: {
  categories: readonly StatementImportCategory[];
  hint: string | null;
  type: StatementLineType;
}): string | null {
  if (!hint) {
    return null;
  }
  const target = normalizeName(hint);
  const match = categories.find(
    (category) =>
      normalizeName(category.name) === target &&
      statementTypeMatchesCategory(type, category.type),
  );
  return match ? match.id : null;
}
