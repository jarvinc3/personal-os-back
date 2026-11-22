/**
 * Signature algorithms accepted for Supabase access tokens. Both are
 * asymmetric, so a shared-secret token (HS256) is never accepted.
 */
export const SUPPORTED_JWT_ALGORITHMS = ['RS256', 'ES256'] as const;
