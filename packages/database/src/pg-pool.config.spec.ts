import {
  defaultRejectUnauthorized,
  isLikelySupabasePostgresUrl,
  poolConfigForPostgresUrl,
  postgresUrlUsesTls,
} from './pg-pool.config';

describe('pg-pool.config', () => {
  const supabaseUrl =
    'postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require';
  const localUrl = 'postgresql://postgres:test@localhost:5432/postgres';

  it('detects Supabase hosts', () => {
    expect(isLikelySupabasePostgresUrl(supabaseUrl)).toBe(true);
    expect(isLikelySupabasePostgresUrl(localUrl)).toBe(false);
  });

  it('enables TLS for sslmode=require and Supabase hosts', () => {
    expect(postgresUrlUsesTls(supabaseUrl)).toBe(true);
    expect(postgresUrlUsesTls(localUrl)).toBe(false);
    expect(
      postgresUrlUsesTls(
        'postgresql://u:p@db.example.supabase.co:5432/postgres',
      ),
    ).toBe(true);
  });

  it('strips sslmode and applies rejectUnauthorized + optional CA', () => {
    const config = poolConfigForPostgresUrl(supabaseUrl, {
      rejectUnauthorized: true,
      ca: '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----',
    });
    expect(config.connectionString).not.toContain('sslmode');
    expect(config.ssl).toEqual({
      rejectUnauthorized: true,
      ca: '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----',
    });
  });

  it('keeps the original string when URL parsing fails', () => {
    const config = poolConfigForPostgresUrl('host=db?sslmode=require', {
      rejectUnauthorized: true,
    });

    expect(config.connectionString).toBe('host=db?sslmode=require');
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('defaults to strict TLS verification in production only', () => {
    expect(defaultRejectUnauthorized('production', undefined)).toBe(true);
    expect(defaultRejectUnauthorized('development', undefined)).toBe(false);
    expect(defaultRejectUnauthorized('production', false)).toBe(false);
    expect(defaultRejectUnauthorized('development', true)).toBe(true);
  });
});
