import { normalizeMerchant } from './normalize-merchant';

/** Why two merchants look like the same one. Never a reason to merge on its own. */
export const MERCHANT_DUPLICATE_REASON = {
  SAME_KEY: 'SAME_KEY',
  ALIAS_MATCH: 'ALIAS_MATCH',
  TRAILING_NUMBER: 'TRAILING_NUMBER',
  NAME_CONTAINED: 'NAME_CONTAINED',
  SIMILAR_NAME: 'SIMILAR_NAME',
} as const;

export type MerchantDuplicateReason =
  (typeof MERCHANT_DUPLICATE_REASON)[keyof typeof MERCHANT_DUPLICATE_REASON];

export type DuplicateComparable = {
  id: string;
  name: string;
  /** Stored key; it does not change when the normalization improves. */
  normalizedKey: string;
  aliases: readonly string[];
};

const MIN_NAME_LENGTH = 5;

/** Keys the merchant answers to: its name and every alias, normalized now. */
function currentKeys(merchant: DuplicateComparable): Set<string> {
  const keys = new Set<string>();
  const nameKey = normalizeMerchant(merchant.name);
  if (nameKey) {
    keys.add(nameKey);
  }
  for (const alias of merchant.aliases) {
    const key = normalizeMerchant(alias);
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

function mainKey(merchant: DuplicateComparable): string {
  return normalizeMerchant(merchant.name) ?? merchant.normalizedKey;
}

/** "Supermercado Nacional 5" -> "SUPERMERCADO NACIONAL". */
function withoutTrailingNumber(key: string): string | null {
  const tokens = key.split(' ');
  const last = tokens[tokens.length - 1];
  if (tokens.length < 2 || !/^\d+$/.test(last)) {
    return null;
  }
  return tokens.slice(0, -1).join(' ');
}

/**
 * Base of a pair where one side is the other plus a final number, e.g.
 * "SUPERMERCADO NACIONAL 5" against "SUPERMERCADO NACIONAL". Needs a real base
 * name, so "STUDIO 54" against "STUDIO" is not proposed.
 */
function trailingNumberBase(left: string, right: string): string | null {
  const leftBase = withoutTrailingNumber(left);
  const rightBase = withoutTrailingNumber(right);
  const bases = [
    leftBase !== null && leftBase === right ? leftBase : null,
    rightBase !== null && rightBase === left ? rightBase : null,
    leftBase !== null && rightBase !== null && leftBase === rightBase
      ? leftBase
      : null,
  ];
  return (
    bases.find(
      (base) => base !== null && letterCount(base) >= MIN_NAME_LENGTH,
    ) ?? null
  );
}

function letterCount(key: string): number {
  return (key.match(/[A-Z]/g) ?? []).length;
}

/** Levenshtein distance, capped: only 0 and 1 matter here. */
function isOneEditApart(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) {
    return false;
  }
  if (left === right) {
    return true;
  }
  let index = 0;
  while (
    index < left.length &&
    index < right.length &&
    left[index] === right[index]
  ) {
    index += 1;
  }
  if (left.length === right.length) {
    return left.slice(index + 1) === right.slice(index + 1);
  }
  return left.length > right.length
    ? left.slice(index + 1) === right.slice(index)
    : left.slice(index) === right.slice(index + 1);
}

/**
 * Reason the two merchants look like the same one, or null. Conservative on
 * purpose: a short name only matches an identical one, and a trailing number
 * needs a real base name, so nothing absurd gets proposed.
 */
export function duplicateReason(
  left: DuplicateComparable,
  right: DuplicateComparable,
): MerchantDuplicateReason | null {
  if (left.id === right.id) {
    return null;
  }
  const leftKey = mainKey(left);
  const rightKey = mainKey(right);
  if (leftKey === rightKey) {
    return MERCHANT_DUPLICATE_REASON.SAME_KEY;
  }

  const leftKeys = currentKeys(left);
  const rightKeys = currentKeys(right);
  for (const key of leftKeys) {
    if (rightKeys.has(key)) {
      return MERCHANT_DUPLICATE_REASON.ALIAS_MATCH;
    }
  }

  const trailingBase = trailingNumberBase(leftKey, rightKey);
  if (trailingBase) {
    return MERCHANT_DUPLICATE_REASON.TRAILING_NUMBER;
  }

  if (letterCount(leftKey) >= MIN_NAME_LENGTH) {
    if (leftKey.includes(rightKey) || rightKey.includes(leftKey)) {
      return MERCHANT_DUPLICATE_REASON.NAME_CONTAINED;
    }
    if (
      letterCount(rightKey) >= MIN_NAME_LENGTH &&
      isOneEditApart(leftKey, rightKey)
    ) {
      return MERCHANT_DUPLICATE_REASON.SIMILAR_NAME;
    }
  }

  return null;
}

export type DuplicateCandidate<T> = {
  merchant: T;
  reason: MerchantDuplicateReason;
};

/** Up to `limit` candidates, closest reason first, never the merchant itself. */
export function findDuplicateCandidates<T extends DuplicateComparable>(
  target: DuplicateComparable,
  others: readonly T[],
  limit: number,
): Array<DuplicateCandidate<T>> {
  const candidates: Array<DuplicateCandidate<T>> = [];
  for (const other of others) {
    const reason = duplicateReason(target, other);
    if (reason) {
      candidates.push({ merchant: other, reason });
    }
  }
  return candidates.slice(0, limit);
}

/** How many other merchants look like this one, for the list flag. */
export function countPossibleDuplicates(
  target: DuplicateComparable,
  others: readonly DuplicateComparable[],
  dismissed: ReadonlySet<string>,
): number {
  let count = 0;
  for (const other of others) {
    if (other.id === target.id || dismissed.has(other.id)) {
      continue;
    }
    if (duplicateReason(target, other)) {
      count += 1;
    }
  }
  return count;
}
