/**
 * Turns the raw merchant text that banks and card networks print into a
 * canonical key, so "UBER *TRIP 1234", "Uber Eats" and "UBER TRIP SANTO
 * DOMINGO" resolve to one merchant, and "Café Lindo" matches "Cafe Lindo".
 *
 * Pure string work: no database, no configuration, no clock.
 */

/** Gateways that prefix the real merchant, e.g. "PAYPAL *NETFLIX". */
const GATEWAY_PREFIXES = [
  'PAYPAL',
  'SQ',
  'SP',
  'TST',
  'DLO',
  'WL',
  'EV',
  'IC',
  'PY',
  'POS',
  'PP',
] as const;

/** Descriptors a brand appends after its name, e.g. "UBER TRIP". */
const DESCRIPTOR_WORDS = new Set(['TRIP', 'EATS', 'RIDE', 'RIDES', 'DRIVE']);

/** City and country tails banks append to the merchant string. */
const CITY_SUFFIXES = [
  ['SANTO', 'DOMINGO'],
  ['DISTRITO', 'NACIONAL'],
  ['DOMINICAN', 'REPUBLIC'],
  ['SANTIAGO'],
  ['DO'],
  ['DOM'],
  ['RD'],
] as const;

/** Web suffix that is part of the brand address, not of its name. */
const DOMAIN_SUFFIX_RE = /\.[A-Z]{2,4}(\.[A-Z]{2,4})?$/;

const MAX_KEY_LENGTH = 40;

const GATEWAY_PREFIX_RE = new RegExp(
  `^(?:${GATEWAY_PREFIXES.join('|')})\\s*\\*`,
);

/** Upper case without accents, so "Café" and "Cafe" fold to the same text. */
function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
}

function isReferenceToken(token: string): boolean {
  if (/^\d{3,}$/.test(token)) {
    return true;
  }
  const digits = (token.match(/\d/g) ?? []).length;
  return digits >= 2 && token.length >= 4;
}

/**
 * Spanish plural marker, applied only to the head word: "Cinemas Centro" and
 * "Cinema Centro" must share a key. Later words are left alone, because surnames
 * and brands legitimately end in S ("Luis Miguel Santos").
 */
function singularizeHead(token: string): string {
  if (!token.endsWith('S') || token.endsWith('SS')) {
    return token;
  }
  return token.length > 4 ? token.slice(0, -1) : token;
}

function stripCitySuffix(tokens: string[]): string[] {
  for (const suffix of CITY_SUFFIXES) {
    if (suffix.length > tokens.length) {
      continue;
    }
    const tail = tokens.slice(tokens.length - suffix.length);
    if (tail.every((token, index) => token === suffix[index])) {
      return tokens.slice(0, tokens.length - suffix.length);
    }
  }
  return tokens;
}

/**
 * Canonical key for a merchant string, or null when nothing usable remains.
 * Upper case, no accents, no web suffix, no gateway prefix, no reference
 * codes, no city tail, plural folded to singular.
 */
export function normalizeMerchant(
  raw: string | null | undefined,
): string | null {
  if (!raw) {
    return null;
  }
  let text = foldAccents(raw)
    .replace(/\s+/g, ' ')
    .replace(DOMAIN_SUFFIX_RE, '')
    .trim();
  if (!text) {
    return null;
  }

  const withoutGateway = text.replace(GATEWAY_PREFIX_RE, '');
  if (withoutGateway !== text) {
    text = withoutGateway.trim();
  }

  const starIndex = text.indexOf('*');
  if (starIndex > 0) {
    text = text.slice(0, starIndex);
  }

  let tokens = text
    .split(' ')
    // Accents are already folded, so only punctuation is left at the edges.
    .map((token) => token.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, ''))
    .filter(Boolean)
    .filter((token) => !isReferenceToken(token))
    .filter((token) => !DESCRIPTOR_WORDS.has(token));
  if (tokens.length > 0) {
    tokens = [singularizeHead(tokens[0]), ...tokens.slice(1)];
  }

  tokens = stripCitySuffix(tokens);
  const key = tokens.join(' ').trim();
  if (!key) {
    return null;
  }
  return key.slice(0, MAX_KEY_LENGTH).trim();
}

/** Display name derived from the canonical key: "UBER" -> "Uber". */
export function merchantDisplayName(
  raw: string | null | undefined,
): string | null {
  const key = normalizeMerchant(raw);
  if (!key) {
    return null;
  }
  return key
    .toLowerCase()
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}
