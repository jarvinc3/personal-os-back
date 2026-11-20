import { parseEnv } from './parse-env';

const validBaseEnv: Record<string, unknown> = {
  DATABASE_URL: 'postgresql://postgres.test:test@localhost:5432/postgres',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:3100/auth/google/callback',
  ENCRYPTION_KEY: 'test-encryption-key-minimum-32-chars!!',
  DATA_ENCRYPTION_KEY: 'test-data-encryption-key-minimum-32-chars!!',
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
  it('defaults the AI limits when omitted', () => {
    const parsed = parseEnv(validBaseEnv);

    expect(parsed.MAX_EMAIL_LLM_EXTRACTS).toBe(25);
    expect(parsed.AI_EMAIL_DAILY_TOKEN_BUDGET).toBe(320_000);
    expect(parsed.AI_EMAIL_CLASSIFICATIONS_PER_MINUTE).toBe(20);
    expect(parsed.AI_EMAIL_INITIAL_BUDGET).toBe(500);
    expect(parsed.AI_EMAIL_DAILY_COST_LIMIT_USD).toBe(5);
    expect(parsed.AI_EMAIL_COST_ALERT_RATIO).toBe(0.8);
    expect(parsed.AI_EMAIL_MAX_CONTENT_CHARS).toBe(24_000);
    expect(parsed.AI_EMAIL_MAX_SUBJECT_CHARS).toBe(1_000);
    expect(parsed.AI_EMAIL_MAX_SENDER_CHARS).toBe(320);
    expect(parsed.AI_PROVIDER_RPM_GROQ).toBe(30);
    expect(parsed.AI_PROVIDER_RPM_OPENROUTER).toBe(20);
    expect(parsed.AI_DAILY_INSIGHT_QUOTA).toBe(20);
    expect(parsed.AI_EMAIL_CLASSIFICATION_BUDGET_MINUTES).toBe(5);
    expect(parsed.AI_EMAIL_SYNC_STALL_MINUTES).toBe(15);
  });

  it('defaults the pilot bank sender list', () => {
    const parsed = parseEnv(validBaseEnv);

    expect(parsed.AI_EMAIL_BANK_SENDER_DOMAINS).toContain('bhd.com.do');
    expect(parsed.AI_EMAIL_BANK_SENDER_DOMAINS).toContain('popularenlinea.com');
    expect(parsed.AI_EMAIL_BANK_SENDER_DOMAINS).toContain('qik.com.do');
    expect(parsed.AI_EMAIL_BANK_SENDER_DOMAINS).toHaveLength(14);
  });

  it('parses the bank sender list and normalizes each domain', () => {
    const parsed = parseEnv({
      ...validBaseEnv,
      AI_EMAIL_BANK_SENDER_DOMAINS: ' BHD.com.do, popular.com.do ,,',
    });

    expect(parsed.AI_EMAIL_BANK_SENDER_DOMAINS).toEqual([
      'bhd.com.do',
      'popular.com.do',
    ]);
  });

  it('treats a blank bank sender list as the default', () => {
    const parsed = parseEnv({
      ...validBaseEnv,
      AI_EMAIL_BANK_SENDER_DOMAINS: '   ',
    });

    expect(parsed.AI_EMAIL_BANK_SENDER_DOMAINS).toContain('bhd.com.do');
    expect(parsed.AI_EMAIL_BANK_SENDER_DOMAINS).toHaveLength(14);
  });

  it('parses numeric strings', () => {
    const parsed = parseEnv({
      ...validBaseEnv,
      MAX_EMAIL_LLM_EXTRACTS: '10',
      AI_EMAIL_DAILY_TOKEN_BUDGET: '250000',
      AI_EMAIL_CLASSIFICATIONS_PER_MINUTE: '5',
      AI_EMAIL_INITIAL_BUDGET: '50',
      AI_EMAIL_DAILY_COST_LIMIT_USD: '2.5',
      AI_EMAIL_COST_ALERT_RATIO: '0.5',
      AI_PROVIDER_RPM_GROQ: '60',
      AI_PROVIDER_RPM_OPENROUTER: '40',
      AI_DAILY_INSIGHT_QUOTA: '5',
      AI_EMAIL_CLASSIFICATION_BUDGET_MINUTES: '3',
      AI_EMAIL_SYNC_STALL_MINUTES: '20',
    });

    expect(parsed.MAX_EMAIL_LLM_EXTRACTS).toBe(10);
    expect(parsed.AI_EMAIL_DAILY_TOKEN_BUDGET).toBe(250_000);
    expect(parsed.AI_EMAIL_CLASSIFICATIONS_PER_MINUTE).toBe(5);
    expect(parsed.AI_EMAIL_INITIAL_BUDGET).toBe(50);
    expect(parsed.AI_EMAIL_DAILY_COST_LIMIT_USD).toBe(2.5);
    expect(parsed.AI_EMAIL_COST_ALERT_RATIO).toBe(0.5);
    expect(parsed.AI_PROVIDER_RPM_GROQ).toBe(60);
    expect(parsed.AI_PROVIDER_RPM_OPENROUTER).toBe(40);
    expect(parsed.AI_DAILY_INSIGHT_QUOTA).toBe(5);
    expect(parsed.AI_EMAIL_CLASSIFICATION_BUDGET_MINUTES).toBe(3);
    expect(parsed.AI_EMAIL_SYNC_STALL_MINUTES).toBe(20);
  });

  it('rejects non-positive limits', () => {
    expect(() =>
      parseEnv({ ...validBaseEnv, MAX_EMAIL_LLM_EXTRACTS: '0' }),
    ).toThrow();
    expect(() =>
      parseEnv({ ...validBaseEnv, AI_EMAIL_DAILY_TOKEN_BUDGET: '0' }),
    ).toThrow();
    expect(() =>
      parseEnv({ ...validBaseEnv, AI_EMAIL_DAILY_COST_LIMIT_USD: '0' }),
    ).toThrow();
    expect(() =>
      parseEnv({ ...validBaseEnv, AI_EMAIL_BANK_SENDER_DOMAINS: ' , ' }),
    ).toThrow();
  });

  it('treats blank limits as the default, matching ai-limits', () => {
    const parsed = parseEnv({
      ...validBaseEnv,
      MAX_EMAIL_LLM_EXTRACTS: '',
      AI_EMAIL_DAILY_TOKEN_BUDGET: ' ',
      AI_EMAIL_DAILY_COST_LIMIT_USD: '  ',
      AI_EMAIL_COST_ALERT_RATIO: '',
      AI_DAILY_INSIGHT_QUOTA: '   ',
    });

    expect(parsed.MAX_EMAIL_LLM_EXTRACTS).toBe(25);
    expect(parsed.AI_EMAIL_DAILY_TOKEN_BUDGET).toBe(320_000);
    expect(parsed.AI_EMAIL_DAILY_COST_LIMIT_USD).toBe(5);
    expect(parsed.AI_EMAIL_COST_ALERT_RATIO).toBe(0.8);
    expect(parsed.AI_DAILY_INSIGHT_QUOTA).toBe(20);
  });
});

describe('envSchema Gmail OAuth encryption key', () => {
  it('requires a dedicated key when any Gmail OAuth setting is configured', () => {
    expect(() =>
      parseEnv({
        ...validBaseEnv,
        NODE_ENV: 'development',
        AI_GMAIL_CLIENT_ID: 'gmail-client-id',
      }),
    ).toThrow(/AI_GMAIL_TOKEN_ENCRYPTION_KEY is required/);
  });

  it('accepts a dedicated key of at least 32 characters', () => {
    const parsed = parseEnv({
      ...validBaseEnv,
      NODE_ENV: 'development',
      AI_GMAIL_CLIENT_ID: 'gmail-client-id',
      AI_GMAIL_CLIENT_SECRET: 'gmail-client-secret',
      AI_GMAIL_REDIRECT_URI:
        'http://localhost:3100/api/intelligence/email/oauth/callback',
      AI_GMAIL_TOKEN_ENCRYPTION_KEY: 'test-gmail-token-encryption-key-32-chars',
    });

    expect(parsed.AI_GMAIL_TOKEN_ENCRYPTION_KEY).toBe(
      'test-gmail-token-encryption-key-32-chars',
    );
  });
});

describe('envSchema PUBLIC_WEB_URL', () => {
  it('accepts a web base URL', () => {
    const parsed = parseEnv({
      ...validBaseEnv,
      PUBLIC_WEB_URL: 'https://personal-os-web-one.vercel.app',
    });

    expect(parsed.PUBLIC_WEB_URL).toBe(
      'https://personal-os-web-one.vercel.app',
    );
  });

  it('trims the value and treats a blank string as unset', () => {
    const withSpaces = parseEnv({
      ...validBaseEnv,
      PUBLIC_WEB_URL: '  https://web.example.com  ',
    });
    const blank = parseEnv({ ...validBaseEnv, PUBLIC_WEB_URL: '   ' });

    expect(withSpaces.PUBLIC_WEB_URL).toBe('https://web.example.com');
    expect(blank.PUBLIC_WEB_URL).toBeUndefined();
  });

  it('rejects a value that is not a URL', () => {
    expect(() =>
      parseEnv({ ...validBaseEnv, PUBLIC_WEB_URL: 'personal-os-web' }),
    ).toThrow(/PUBLIC_WEB_URL must be a valid URL/);
  });
});

describe('envSchema Firebase push credential', () => {
  it('accepts the three FCM variables separately', () => {
    const parsed = parseEnv({
      ...validBaseEnv,
      FIREBASE_PROJECT_ID: 'personal-os-test',
      FIREBASE_CLIENT_EMAIL: 'push@example.test',
      FIREBASE_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----\\n',
    });

    expect(parsed.FIREBASE_PROJECT_ID).toBe('personal-os-test');
    expect(parsed.FIREBASE_CLIENT_EMAIL).toBe('push@example.test');
    expect(parsed.FIREBASE_PRIVATE_KEY).toBe(
      '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----\\n',
    );
  });

  it('accepts omitting all three variables', () => {
    const parsed = parseEnv(validBaseEnv);

    expect(parsed.FIREBASE_PROJECT_ID).toBeUndefined();
    expect(parsed.FIREBASE_CLIENT_EMAIL).toBeUndefined();
    expect(parsed.FIREBASE_PRIVATE_KEY).toBeUndefined();
  });

  it('ignores the removed service account variables', () => {
    const parsed = parseEnv({
      ...validBaseEnv,
      FIREBASE_SERVICE_ACCOUNT_JSON: '{"project_id":"personal-os-test"}',
      FIREBASE_SERVICE_ACCOUNT_PATH: '/tmp/firebase-service-account.json',
    });

    expect(parsed).not.toHaveProperty('FIREBASE_SERVICE_ACCOUNT_JSON');
    expect(parsed).not.toHaveProperty('FIREBASE_SERVICE_ACCOUNT_PATH');
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

describe('envSchema CORS_ORIGIN_PATTERNS', () => {
  const previewPattern =
    '^https://personal-os-web-git-[a-z0-9-]+-collado-studios\\.vercel\\.app$';

  it('accepts anchored preview patterns outside production', () => {
    const parsed = parseEnv({
      ...validBaseEnv,
      NODE_ENV: 'development',
      CORS_ORIGIN_PATTERNS: ` ${previewPattern} `,
    });

    expect(parsed.CORS_ORIGIN_PATTERNS).toBe(previewPattern);
  });

  it('treats a blank value as omitted', () => {
    const parsed = parseEnv({ ...validBaseEnv, CORS_ORIGIN_PATTERNS: '  ' });

    expect(parsed.CORS_ORIGIN_PATTERNS).toBeUndefined();
  });

  it('rejects a pattern that is not anchored', () => {
    expect(() =>
      parseEnv({
        ...validBaseEnv,
        CORS_ORIGIN_PATTERNS: 'https://personal-os-web-git-.*',
      }),
    ).toThrow(/must be anchored with \^ and \$/);
  });

  it('rejects the variable in production', () => {
    expect(() =>
      parseEnv({
        ...validBaseEnv,
        NODE_ENV: 'production',
        REDIS_URL: 'redis://localhost:6379',
        CORS_ORIGIN_PATTERNS: previewPattern,
      }),
    ).toThrow(/CORS_ORIGIN_PATTERNS is not allowed in production/);
  });
});
