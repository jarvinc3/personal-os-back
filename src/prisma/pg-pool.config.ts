import type { PoolConfig } from 'pg';

/**
 * Supabase / cloud Postgres URLs use TLS. The `pg` driver also reads
 * `sslmode` from the URL; combined with Node 22+ / pg-connection-string,
 * `require` can still verify the full chain and fail on pooler intermediates.
 * We enable TLS explicitly via `Pool.ssl` and drop `sslmode` from the URL so
 * `rejectUnauthorized` from env is respected.
 */
export function isLikelySupabasePostgresUrl(connectionString: string): boolean {
  const lower = connectionString.toLowerCase();
  return (
    lower.includes('.pooler.supabase.com') || lower.includes('.supabase.co')
  );
}

export function postgresUrlUsesTls(connectionString: string): boolean {
  const lower = connectionString.toLowerCase();
  const sslmodeRaw = lower.match(/[?&]sslmode=([^&]+)/)?.[1];
  const sslmode = sslmodeRaw?.replace(/\+/g, ' ');
  if (sslmode === 'disable' || sslmode === 'false') return false;
  if (sslmode) return true;
  return isLikelySupabasePostgresUrl(connectionString);
}

export function poolConfigForPostgresUrl(
  connectionString: string,
  rejectUnauthorized: boolean,
): PoolConfig {
  if (!postgresUrlUsesTls(connectionString)) {
    return { connectionString };
  }

  try {
    const url = new URL(connectionString);
    url.searchParams.delete('sslmode');
    return {
      connectionString: url.toString(),
      ssl: { rejectUnauthorized },
    };
  } catch {
    return {
      connectionString,
      ssl: { rejectUnauthorized },
    };
  }
}

/** Default TLS verification for scripts / Nest when env is unset. */
export function defaultRejectUnauthorized(
  connectionString: string,
  nodeEnv: string | undefined,
  explicit: boolean | undefined,
): boolean {
  if (explicit !== undefined) return explicit;
  return (
    nodeEnv === 'production' && !isLikelySupabasePostgresUrl(connectionString)
  );
}
