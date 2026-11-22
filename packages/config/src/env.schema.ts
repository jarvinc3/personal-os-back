import { z } from 'zod';
import {
  DEFAULT_BANK_SENDER_DOMAINS,
  defaultedPositiveInt,
  defaultedStrictBoolean,
  optionalApiKey,
  optionalStrictBoolean,
} from './env-helpers';
import {
  checkAiProviderKey,
  checkBullBoardCredentials,
  checkCorsOriginPatterns,
  checkGmailEncryptionKey,
  checkOAuthKeysDiffer,
  checkOAuthStateSecret,
  requireEmailDeliveryDependencies,
  requireRedisInProduction,
} from './env-refinements';

export const envSchema = z
  .object({
    // ── Base de datos ────────────────────────────────────────────
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // ── Supabase ──────────────────────────────────────────────
    SUPABASE_URL: z.url('SUPABASE_URL must be a valid URL'),
    SUPABASE_SERVICE_ROLE_KEY: z
      .string()
      .min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
    /** Logo.dev secret key. Search is skipped when unset. */
    LOGO_DEV_SECRET_KEY: optionalApiKey,
    /** Logo.dev publishable key. Logo download is skipped when unset. */
    LOGO_DEV_PUBLISHABLE_KEY: optionalApiKey,

    // ── IA providers ───────────────────────────
    GROQ_API_KEY: optionalApiKey,
    OPENROUTER_API_KEY: optionalApiKey,
    /** Peticiones por minuto del plan contratado; el piloto usa el 80 %. */
    AI_PROVIDER_RPM_GROQ: defaultedPositiveInt(30),
    AI_PROVIDER_RPM_OPENROUTER: defaultedPositiveInt(20),
    AI_GMAIL_CLIENT_ID: optionalApiKey,
    AI_GMAIL_CLIENT_SECRET: optionalApiKey,
    AI_GMAIL_TOKEN_ENCRYPTION_KEY: z
      .string()
      .min(32, 'AI_GMAIL_TOKEN_ENCRYPTION_KEY must be at least 32 chars')
      .optional(),
    /** Firma el state OAuth de Gmail; no cifra tokens. */
    OAUTH_STATE_SECRET: z
      .string()
      .min(32, 'OAUTH_STATE_SECRET must be at least 32 chars')
      .optional(),
    AI_GMAIL_REDIRECT_URI: z
      .string()
      .optional()
      .transform((value) => value?.trim() || undefined)
      .pipe(z.union([z.url(), z.undefined()])),
    /** Dev-only seed target for the initial Intelligence administrator. */
    AI_DEV_ADMIN_EMAIL: optionalApiKey,
    AI_EMAIL_SYNC_INTERVAL_MINUTES: defaultedPositiveInt(10),
    /** Tope de minutos que una corrida dedica a clasificar correo atrasado. */
    AI_EMAIL_CLASSIFICATION_BUDGET_MINUTES: defaultedPositiveInt(5),
    /** Minutos sin avance tras los que una sincronización «running» se marca caída. */
    AI_EMAIL_SYNC_STALL_MINUTES: defaultedPositiveInt(15),
    /** Minimum distinct contributors for automatic GLOBAL knowledge. */
    AI_GLOBAL_MIN_CONTRIBUTORS: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z.coerce.number().int().positive().optional(),
    ),
    /** Hard cap on LLM email extractions per Gmail sync. Default 25. */
    MAX_EMAIL_LLM_EXTRACTS: defaultedPositiveInt(25),
    /** Clasificaciones por minuto y usuario; la tabla compartida las reserva. */
    AI_EMAIL_CLASSIFICATIONS_PER_MINUTE: defaultedPositiveInt(20),
    /** Clasificaciones de carga inicial por conexión de Gmail. */
    AI_EMAIL_INITIAL_BUDGET: defaultedPositiveInt(500),
    /** Tokens por usuario y día UTC; reemplaza al tope de llamadas diarias. */
    AI_EMAIL_DAILY_TOKEN_BUDGET: defaultedPositiveInt(320_000),
    /** Tope global de costo del piloto por día UTC, en dólares. */
    AI_EMAIL_DAILY_COST_LIMIT_USD: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z.coerce.number().positive().default(5),
    ),
    /** Proporción del tope global a la que se registra la alerta. */
    AI_EMAIL_COST_ALERT_RATIO: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z.coerce.number().min(0).max(1).default(0.8),
    ),
    /** Contenido del correo que se envía al modelo, en caracteres. */
    AI_EMAIL_MAX_CONTENT_CHARS: defaultedPositiveInt(24_000),
    /** Asunto del correo que acompaña al contenido, en caracteres. */
    AI_EMAIL_MAX_SUBJECT_CHARS: defaultedPositiveInt(1_000),
    /** Remitente del correo que acompaña al contenido, en caracteres. */
    AI_EMAIL_MAX_SENDER_CHARS: defaultedPositiveInt(320),
    /** Dominios bancarios del piloto, separados por coma. */
    AI_EMAIL_BANK_SENDER_DOMAINS: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z
        .string()
        .default(DEFAULT_BANK_SENDER_DOMAINS)
        .transform((value) =>
          value
            .split(',')
            .map((domain) => domain.trim().toLowerCase())
            .filter(Boolean),
        )
        .refine(
          (domains) => domains.length > 0,
          'AI_EMAIL_BANK_SENDER_DOMAINS needs at least one domain',
        ),
    ),
    /** Maximum view suggestion gateway calls per user and UTC day. */
    AI_VIEW_SUGGESTION_DAILY_MODEL_BUDGET: defaultedPositiveInt(100),
    /** Minutes a generated set of view suggestions stays cached. */
    AI_VIEW_SUGGESTION_TTL_MINUTES: defaultedPositiveInt(30),
    /** Max proactive insight LLM calls per user per UTC day. Default 20. */
    AI_DAILY_INSIGHT_QUOTA: defaultedPositiveInt(20),

    // ── Sentry (observabilidad) ───────────────────────────────
    /** Sin DSN la SDK no se inicializa; tests y CI quedan en no-op. */
    SENTRY_DSN: optionalApiKey,
    SENTRY_TRACES_SAMPLE_RATE: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z.coerce.number().min(0).max(1).default(0.1),
    ),
    /** Solo para subir source maps; sin token el build no falla. */
    SENTRY_AUTH_TOKEN: optionalApiKey,
    SENTRY_ORG: optionalApiKey,
    SENTRY_PROJECT: optionalApiKey,

    /** Encrypts bank account numbers at rest. */
    DATA_ENCRYPTION_KEY: z
      .string()
      .min(32, 'DATA_ENCRYPTION_KEY must be at least 32 chars'),

    // ── App ──────────────────────────────────────────────────────
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),

    PORT: z.coerce.number().int().positive().default(3100),
    CORS_ORIGIN: z
      .string()
      .min(1, 'CORS_ORIGIN is required')
      .refine(
        (value) => {
          const origins = value
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean);
          return origins.every((origin) => {
            try {
              new URL(origin);
              return true;
            } catch {
              return false;
            }
          });
        },
        {
          message:
            'CORS_ORIGIN must be one or more valid URLs separated by commas',
        },
      ),
    /**
     * Anchored regex sources for branch preview origins (CSV). Only allowed
     * outside production: production keeps the exact `CORS_ORIGIN` list.
     */
    CORS_ORIGIN_PATTERNS: z
      .string()
      .optional()
      .transform((value) => {
        const trimmed = value?.trim();
        return trimmed || undefined;
      }),
    /**
     * Base URL of the public web app used to build links shared with other
     * people (`<PUBLIC_WEB_URL>/c/<token>`). Falls back to the first
     * CORS_ORIGIN entry when unset.
     */
    PUBLIC_WEB_URL: z
      .string()
      .optional()
      .transform((value) => {
        const trimmed = value?.trim();
        return trimmed || undefined;
      })
      .pipe(
        z.union([z.url('PUBLIC_WEB_URL must be a valid URL'), z.undefined()]),
      ),
    REDIS_URL: z
      .string()
      .optional()
      .transform((value) => {
        const trimmed = value?.trim();
        if (!trimmed) {
          return undefined;
        }
        return trimmed;
      })
      .pipe(z.union([z.string().url(), z.undefined()])),
    REDIS_ENABLED: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((value) => {
        if (value === true || value === 'true' || value === '1') {
          return true;
        }
        return false;
      }),
    /** Optional HTTP basic auth for Bull Board (both or neither). */
    BULL_BOARD_USER: z
      .string()
      .optional()
      .transform((value) => {
        const trimmed = value?.trim();
        return trimmed || undefined;
      }),
    BULL_BOARD_PASSWORD: z
      .string()
      .optional()
      .transform((value) => {
        const trimmed = value?.trim();
        return trimmed || undefined;
      }),
    DATABASE_SSL_REJECT_UNAUTHORIZED: optionalStrictBoolean,
    /** PEM CA bundle for Postgres TLS (optional; uses system CAs when unset). */
    DATABASE_SSL_CA: z
      .string()
      .optional()
      .transform((value) => {
        const trimmed = value?.trim();
        return trimmed || undefined;
      }),
    API_PREFIX: z
      .string()
      .default('api')
      .transform((v) => v.replace(/^\/+|\/+$/g, '')),
    SWAGGER_PATH: z.string().default('docs'),

    // ── Moneda base (para conversiones) ─────────────────────────
    BASE_CURRENCY: z
      .string()
      .length(3, 'BASE_CURRENCY must be a 3-letter ISO code')
      .default('DOP')
      .transform((v) => v.toUpperCase()),
    EXCHANGE_RATE_HOST_API_KEY: optionalApiKey,

    // ── Push (FCM Android + Web Push) ───────────────────────────
    EXPO_ACCESS_TOKEN: optionalApiKey,
    /** Service account for FCM; all three are needed to enable the channel. */
    FIREBASE_PROJECT_ID: optionalApiKey,
    FIREBASE_CLIENT_EMAIL: optionalApiKey,
    FIREBASE_PRIVATE_KEY: optionalApiKey,
    VAPID_PUBLIC_KEY: optionalApiKey,
    VAPID_PRIVATE_KEY: optionalApiKey,
    VAPID_SUBJECT: z
      .string()
      .optional()
      .transform((value) => {
        const trimmed = value?.trim();
        if (!trimmed) {
          return undefined;
        }
        return trimmed;
      }),

    // ── Email delivery (Resend) ──────────────────────────────────
    EMAIL_DELIVERY_ENABLED: defaultedStrictBoolean(
      'EMAIL_DELIVERY_ENABLED',
      false,
    ),
    RESEND_API_KEY: optionalApiKey,
    MAIL_FROM: z
      .string()
      .optional()
      .transform((value) => {
        const trimmed = value?.trim();
        return trimmed || undefined;
      }),
  })
  .superRefine((data, ctx) => {
    const gmailConfigured =
      Boolean(data.AI_GMAIL_CLIENT_ID) ||
      Boolean(data.AI_GMAIL_CLIENT_SECRET) ||
      Boolean(data.AI_GMAIL_REDIRECT_URI);

    checkCorsOriginPatterns(
      { nodeEnv: data.NODE_ENV, patterns: data.CORS_ORIGIN_PATTERNS },
      ctx,
    );
    requireRedisInProduction(
      { nodeEnv: data.NODE_ENV, redisUrl: data.REDIS_URL },
      ctx,
    );
    checkBullBoardCredentials(
      { user: data.BULL_BOARD_USER, password: data.BULL_BOARD_PASSWORD },
      ctx,
    );
    requireEmailDeliveryDependencies(
      {
        enabled: data.EMAIL_DELIVERY_ENABLED,
        resendApiKey: data.RESEND_API_KEY,
        mailFrom: data.MAIL_FROM,
      },
      ctx,
    );
    checkGmailEncryptionKey(
      {
        gmailConfigured,
        tokenKey: data.AI_GMAIL_TOKEN_ENCRYPTION_KEY,
      },
      ctx,
    );
    checkOAuthStateSecret(
      {
        nodeEnv: data.NODE_ENV,
        gmailConfigured,
        stateSecret: data.OAUTH_STATE_SECRET,
      },
      ctx,
    );
    checkOAuthKeysDiffer(
      {
        stateSecret: data.OAUTH_STATE_SECRET,
        tokenKey: data.AI_GMAIL_TOKEN_ENCRYPTION_KEY,
      },
      ctx,
    );
    checkAiProviderKey(
      {
        nodeEnv: data.NODE_ENV,
        groqKey: data.GROQ_API_KEY,
        openrouterKey: data.OPENROUTER_API_KEY,
      },
      ctx,
    );
  });

export type Env = z.infer<typeof envSchema>;
