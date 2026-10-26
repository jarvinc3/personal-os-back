/**
 * Non-production CORS for branch previews. Preview origins rotate per branch,
 * so they are matched against anchored patterns instead of the exact
 * `CORS_ORIGIN` list. Production keeps the exact list only.
 */
export function parseCorsOriginPatterns(
  rawPatterns: string | undefined,
): RegExp[] {
  if (!rawPatterns) {
    return [];
  }

  return rawPatterns
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map(compileAnchoredPattern);
}

function compileAnchoredPattern(pattern: string): RegExp {
  if (!pattern.startsWith('^') || !pattern.endsWith('$')) {
    throw new Error(
      `CORS_ORIGIN_PATTERNS entry must be anchored with ^ and $: ${pattern}`,
    );
  }

  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new Error(`Invalid CORS_ORIGIN_PATTERNS entry: ${pattern}`, {
      cause: error,
    });
  }
}

type CorsOriginCheck = {
  origin: string;
  allowedOrigins: readonly string[];
  originPatterns?: readonly RegExp[];
};

/** True when the origin is listed or matches one of the allowed patterns. */
export function isAllowedCorsOrigin({
  origin,
  allowedOrigins,
  originPatterns = [],
}: CorsOriginCheck): boolean {
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    return true;
  }

  return originPatterns.some((pattern) => pattern.test(origin));
}
