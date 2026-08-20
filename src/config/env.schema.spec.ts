import { parseEnv } from './parse-env';

const validBaseEnv: Record<string, unknown> = {
  DATABASE_URL: 'postgresql://postgres.test:test@localhost:5432/postgres',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:3100/auth/google/callback',
  ENCRYPTION_KEY: 'test-encryption-key-minimum-32-chars!!',
  CORS_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
  GROQ_API_KEY: 'test-groq-key',
};

describe('envSchema Bull Board credentials', () => {
  it('accepts both BULL_BOARD_USER and BULL_BOARD_PASSWORD', () => {
    const parsed = parseEnv({
      ...validBaseEnv,
      BULL_BOARD_USER: 'admin',
      BULL_BOARD_PASSWORD: 'secret',
    });

    expect(parsed.BULL_BOARD_USER).toBe('admin');
    expect(parsed.BULL_BOARD_PASSWORD).toBe('secret');
  });

  it('accepts omitting both credentials', () => {
    const parsed = parseEnv(validBaseEnv);

    expect(parsed.BULL_BOARD_USER).toBeUndefined();
    expect(parsed.BULL_BOARD_PASSWORD).toBeUndefined();
  });

  it('rejects only BULL_BOARD_USER set', () => {
    expect(() =>
      parseEnv({
        ...validBaseEnv,
        BULL_BOARD_USER: 'admin',
      }),
    ).toThrow(
      /BULL_BOARD_USER and BULL_BOARD_PASSWORD must both be set or both omitted/,
    );
  });

  it('rejects only BULL_BOARD_PASSWORD set', () => {
    expect(() =>
      parseEnv({
        ...validBaseEnv,
        BULL_BOARD_PASSWORD: 'secret',
      }),
    ).toThrow(
      /BULL_BOARD_USER and BULL_BOARD_PASSWORD must both be set or both omitted/,
    );
  });

  it('treats empty strings as omitted', () => {
    const parsed = parseEnv({
      ...validBaseEnv,
      BULL_BOARD_USER: '  ',
      BULL_BOARD_PASSWORD: '',
    });

    expect(parsed.BULL_BOARD_USER).toBeUndefined();
    expect(parsed.BULL_BOARD_PASSWORD).toBeUndefined();
  });
});
