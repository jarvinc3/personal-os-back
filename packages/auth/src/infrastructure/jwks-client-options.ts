import type { SupabaseAuthConfig } from '@personal-os/config';

/**
 * Options every JWKS consumer shares: the passport strategy and the manual
 * verifier must hit the same URI with the same cache and rate limit.
 */
export type JwksClientOptions = {
  cache: boolean;
  rateLimit: boolean;
  jwksRequestsPerMinute: number;
  jwksUri: string;
};

const JWKS_REQUESTS_PER_MINUTE = 10;

export function buildJwksClientOptions(
  authConfig: SupabaseAuthConfig,
): JwksClientOptions {
  return {
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: JWKS_REQUESTS_PER_MINUTE,
    jwksUri: authConfig.jwksUri,
  };
}
