import type { FinTxStatus } from '../../ledger/application/commands/ledger.commands';
import type { CategoryResolveSource } from '../../shared/domain/category-type';

const MAX_NOTES_CHARS = 500;

/**
 * Combine LLM review notes with deterministic import warnings for FinTransaction.notes.
 */
export function buildEmailImportNotes(input: {
  llmNotes?: string | null;
  categoryId: string | null;
  categorySource: CategoryResolveSource | null;
  categoryNameHint?: string | null;
  status: FinTxStatus;
  skipUncategorizedWarning?: boolean;
}): string | null {
  const parts: string[] = [];

  const llm = input.llmNotes?.trim();
  if (llm) {
    parts.push(llm);
  }

  if (!input.skipUncategorizedWarning) {
    if (!input.categoryId) {
      const hint = input.categoryNameHint?.trim();
      parts.push(
        hint
          ? `Sin categoría asignada (hint: ${hint}).`
          : 'Sin categoría asignada; revisa el movimiento.',
      );
    } else if (input.categorySource === 'merchant_history') {
      parts.push(
        'Categoría tomada de un movimiento anterior del mismo comercio.',
      );
    }
  }

  if (input.status === 'PENDING') {
    parts.push('Confirma el estado del movimiento.');
  }

  const unique = dedupeParts(parts);
  if (unique.length === 0) {
    return null;
  }

  const joined = unique.join(' ');
  return joined.length <= MAX_NOTES_CHARS
    ? joined
    : `${joined.slice(0, MAX_NOTES_CHARS - 1)}…`;
}

function dedupeParts(parts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(part);
  }
  return out;
}
