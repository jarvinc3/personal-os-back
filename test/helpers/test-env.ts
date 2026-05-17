export function applyTestEnv(): void {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ??
    'postgresql://postgres.test:test@localhost:5432/postgres';
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL =
    process.env.SUPABASE_URL ?? 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY =
    process.env.SUPABASE_ANON_KEY ?? 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-key';
  process.env.GROQ_API_KEY = '';
  process.env.CEREBRAS_API_KEY = '';
  process.env.OPENROUTER_API_KEY = '';
  process.env.GOOGLE_CLIENT_ID =
    process.env.GOOGLE_CLIENT_ID ?? 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET =
    process.env.GOOGLE_CLIENT_SECRET ?? 'test-google-client-secret';
  process.env.GOOGLE_REDIRECT_URI =
    process.env.GOOGLE_REDIRECT_URI ??
    'http://localhost:3100/auth/google/callback';
  process.env.CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  process.env.API_URL = process.env.API_URL ?? 'http://localhost:3100';
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
  process.env.REDIS_ENABLED = process.env.REDIS_ENABLED ?? 'false';
}
