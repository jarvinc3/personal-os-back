const FETCH_GUARD_MARKER = '__personalOsE2eFetchGuardInstalled' as const;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const blockedExternalFetchAttempts: string[] = [];

export const EXTERNAL_FETCH_BLOCKED_MESSAGE =
  'External network requests are disabled in E2E tests.';

type GuardedGlobal = typeof globalThis & {
  [FETCH_GUARD_MARKER]?: boolean;
};

export function applyTestEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL =
    'postgresql://postgres.test:test@127.0.0.1:1/postgres';
  process.env.SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.LOGO_DEV_SECRET_KEY = '';
  process.env.LOGO_DEV_PUBLISHABLE_KEY = '';
  process.env.GROQ_API_KEY = '';
  process.env.OPENROUTER_API_KEY = '';
  process.env.AI_GMAIL_CLIENT_ID = '';
  process.env.AI_GMAIL_CLIENT_SECRET = '';
  process.env.AI_GMAIL_REDIRECT_URI = '';
  process.env.AI_GMAIL_TOKEN_ENCRYPTION_KEY =
    'test-encryption-key-minimum-32-chars!!';
  process.env.EXCHANGE_RATE_HOST_API_KEY = '';
  process.env.EXPO_ACCESS_TOKEN = '';
  process.env.FIREBASE_PROJECT_ID = '';
  process.env.FIREBASE_CLIENT_EMAIL = '';
  process.env.FIREBASE_PRIVATE_KEY = '';
  process.env.VAPID_PUBLIC_KEY = '';
  process.env.VAPID_PRIVATE_KEY = '';
  process.env.VAPID_SUBJECT = '';
  process.env.RESEND_API_KEY = '';
  process.env.MAIL_FROM = '';
  process.env.GOOGLE_CLIENT_ID = '';
  process.env.GOOGLE_CLIENT_SECRET = '';
  process.env.GOOGLE_REDIRECT_URI =
    'http://localhost:3100/auth/google/callback';
  process.env.CORS_ORIGIN = 'http://localhost:5173';
  process.env.PUBLIC_WEB_URL = 'https://web.test';
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  process.env.REDIS_ENABLED = 'false';
  process.env.ENCRYPTION_KEY = 'test-encryption-key-minimum-32-chars!!';
  process.env.OAUTH_STATE_SECRET = 'test-oauth-state-secret-minimum-32chars';
  process.env.DATA_ENCRYPTION_KEY =
    'test-data-encryption-key-minimum-32-chars!!';
  process.env.EMAIL_DELIVERY_ENABLED = 'false';

  installExternalFetchGuard();
}

export function takeBlockedExternalFetchAttempts(): string[] {
  return blockedExternalFetchAttempts.splice(0);
}

function installExternalFetchGuard(): void {
  const guardedGlobal = globalThis as GuardedGlobal;
  if (guardedGlobal[FETCH_GUARD_MARKER]) {
    return;
  }

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = getFetchRequestUrl(input);
    if (!LOCAL_HOSTS.has(requestUrl.hostname)) {
      blockedExternalFetchAttempts.push(requestUrl.origin);
      return Promise.reject(
        new Error(`${EXTERNAL_FETCH_BLOCKED_MESSAGE} ${requestUrl.origin}`),
      );
    }
    return originalFetch(input, init);
  };
  guardedGlobal[FETCH_GUARD_MARKER] = true;
}

function getFetchRequestUrl(input: Parameters<typeof fetch>[0]): URL {
  const inputUrl =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return new URL(inputUrl);
}
