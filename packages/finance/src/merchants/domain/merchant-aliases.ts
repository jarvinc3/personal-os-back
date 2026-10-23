/** Alias list bounds: part of the merchant contract. */
export const MAX_MERCHANT_ALIASES = 20;
export const MAX_MERCHANT_ALIAS_LENGTH = 120;

function aliasKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Trims, drops empties and removes duplicates without distinguishing case or
 * accents, keeping the text as the user wrote it and the first position.
 */
export function normalizeAliasList(aliases: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const alias of aliases) {
    const text = alias.trim();
    const key = aliasKey(text);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(text);
  }
  return normalized;
}
