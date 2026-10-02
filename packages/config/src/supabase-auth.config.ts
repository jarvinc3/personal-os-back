import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

export type SupabaseAuthConfig = {
  supabaseUrl: string;
  issuer: string;
  jwksUri: string;
  audience: string;
};

export function getSupabaseAuthConfig(
  config: ConfigService<Env, true>,
): SupabaseAuthConfig {
  const supabaseUrl = config.getOrThrow('SUPABASE_URL', {
    infer: true,
  });
  const normalized = supabaseUrl.replace(/\/$/, '');

  return {
    supabaseUrl: normalized,
    issuer: `${normalized}/auth/v1`,
    jwksUri: `${normalized}/auth/v1/.well-known/jwks.json`,
    audience: 'authenticated',
  };
}
