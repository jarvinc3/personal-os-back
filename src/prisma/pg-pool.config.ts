import type { PoolConfig } from 'pg';

/**
 * Supabase / cloud Postgres URLs use TLS. The `pg` driver also reads
 * `sslmode` from the URL; combined with Node 22+ / pg-connection-string,
 * `require` can still verify the full chain and fail on pooler intermediates.
 * We enable TLS explicitly via `Pool.ssl` and drop `sslmode` from the URL so
 * `rejectUnauthorized` and optional `ca` from env are respected.
 *
 * Production always defaults to full chain verification (`rejectUnauthorized: true`).
 * Only non-production may relax verification. Explicit env always wins.
 */
export type PostgresSslOptions = {
  rejectUnauthorized: boolean;
  /** PEM-encoded CA bundle (one or more certs). */
  ca?: string;
};

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
  ssl: PostgresSslOptions,
): PoolConfig {
  if (!postgresUrlUsesTls(connectionString)) {
    return { connectionString };
  }

  const sslConfig: { rejectUnauthorized: boolean; ca?: string } = {
    rejectUnauthorized: ssl.rejectUnauthorized,
  };
  if (ssl.ca?.trim()) {
    sslConfig.ca = ssl.ca.trim();
  }

  try {
    const url = new URL(connectionString);
    url.searchParams.delete('sslmode');
    return {
      connectionString: url.toString(),
      ssl: sslConfig,
    };
  } catch {
    return {
      connectionString,
      ssl: sslConfig,
    };
  }
}

/**
 * Default TLS verification when `DATABASE_SSL_REJECT_UNAUTHORIZED` is unset.
 * Production always verifies; non-production relaxes for local tooling.
 */
export function defaultRejectUnauthorized(
  nodeEnv: string | undefined,
  explicit: boolean | undefined,
): boolean {
  if (explicit !== undefined) return explicit;
  return nodeEnv === 'production';
}
