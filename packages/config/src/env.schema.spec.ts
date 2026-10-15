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

describe('envSchema AI limits', () => {
  it('defaults both limits when omitted', () => {
    const parsed = parseEnv(validBaseEnv);

    expect(parsed.MAX_EMAIL_LLM_EXTRACTS).toBe(25);
    expect(parsed.AI_DAILY_INSIGHT_QUOTA).toBe(20);
  });

  it('parses numeric strings', () => {
    const parsed = parseEnv({
      ...validBaseEnv,
      MAX_EMAIL_LLM_EXTRACTS: '10',
      AI_DAILY_INSIGHT_QUOTA: '5',
    });

    expect(parsed.MAX_EMAIL_LLM_EXTRACTS).toBe(10);
    expect(parsed.AI_DAILY_INSIGHT_QUOTA).toBe(5);
  });

  it('rejects non-positive limits', () => {
    expect(() =>
      parseEnv({ ...validBaseEnv, MAX_EMAIL_LLM_EXTRACTS: '0' }),
    ).toThrow();
  });

  it('treats blank limits as the default, matching ai-limits', () => {
    const parsed = parseEnv({
      ...validBaseEnv,
      MAX_EMAIL_LLM_EXTRACTS: '',
      AI_DAILY_INSIGHT_QUOTA: '   ',
    });

    expect(parsed.MAX_EMAIL_LLM_EXTRACTS).toBe(25);
    expect(parsed.AI_DAILY_INSIGHT_QUOTA).toBe(20);
  });
});

describe('envSchema Sentry', () => {
  it('omits Sentry settings when no DSN is set', () => {
    const parsed = parseEnv(validBaseEnv);

    expect(parsed.SENTRY_DSN).toBeUndefined();
    expect(parsed.SENTRY_TRACES_SAMPLE_RATE).toBe(0.1);
  });

  it('accepts a DSN, a token, and a sample rate', () => {
    const parsed = parseEnv({
      ...validBaseEnv,
      SENTRY_DSN: 'https://key@o0.ingest.sentry.io/0',
      SENTRY_TRACES_SAMPLE_RATE: '0.5',
      SENTRY_AUTH_TOKEN: 'sntrys_token',
      SENTRY_ORG: 'collado-studios',
      SENTRY_PROJECT: 'personal-os-back',
    });

    expect(parsed.SENTRY_DSN).toBe('https://key@o0.ingest.sentry.io/0');
    expect(parsed.SENTRY_TRACES_SAMPLE_RATE).toBe(0.5);
    expect(parsed.SENTRY_AUTH_TOKEN).toBe('sntrys_token');
  });

  it('falls back to the default sample rate on a blank value', () => {
    const parsed = parseEnv({
      ...validBaseEnv,
      SENTRY_TRACES_SAMPLE_RATE: '',
    });

    expect(parsed.SENTRY_TRACES_SAMPLE_RATE).toBe(0.1);
  });

  it('rejects a sample rate outside 0..1', () => {
    expect(() =>
      parseEnv({ ...validBaseEnv, SENTRY_TRACES_SAMPLE_RATE: '1.5' }),
    ).toThrow();
  });
});
