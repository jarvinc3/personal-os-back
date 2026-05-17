import type { SupabaseAuthConfig } from '../../../config/supabase-auth.config';
import { createPassportJwksSecret } from './jwks-rsa.loader';

export function createJwksSecretProvider(authConfig: SupabaseAuthConfig) {
  return createPassportJwksSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 10,
    jwksUri: authConfig.jwksUri,
  });
}
