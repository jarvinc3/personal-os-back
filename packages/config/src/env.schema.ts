import { z } from 'zod';
import { parseCorsOriginPatterns } from './cors-origins';
import { parseStrictEnvBoolean } from './parse-env-boolean';

const optionalApiKey = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.startsWith('YOUR_')) {
      return undefined;
    }
    return trimmed;
  });

/** Positive integer env value; a blank string falls back to the default. */
const defaultedPositiveInt = (defaultValue: number) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.coerce.number().int().positive().default(defaultValue),
  );

/** true/false/1/0 only — never treat the string "false" as true. */
const optionalStrictBoolean = z
  .unknown()
  .optional()
  .transform((value, ctx) => {
    try {
      return parseStrictEnvBoolean(value, 'DATABASE_SSL_REJECT_UNAUTHORIZED');
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message:
          error instanceof Error
            ? error.message
            : 'Invalid boolean environment value',
      });
      return z.NEVER;
    }
  });

/**
 * Dominios bancarios que el piloto deja llegar al modelo. Son el valor por
 * defecto de `AI_EMAIL_BANK_SENDER_DOMAINS`; los subdominios se aceptan.
 */
const DEFAULT_BANK_SENDER_DOMAINS = [
  'bhd.com.do',
  'popular.com.do',
  'qik.do',
  'banreservas.com',
  'scotiabank.com.do',
  'bancosantacruz.com.do',
  'bancolopezdeharo.com',
  'vimenca.com',
  'bancocaribe.com.do',
  'promerica.com.do',
  'bdi.com.do',
  'alaver.com.do',
].join(',');

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
    AI_EMAIL_BANK_SENDER_DOMAINS: z
      .string()
      .default(DEFAULT_BANK_SENDER_DOMAINS)
      .transform((value) =>
        value
          .split(',')
          .map((domain) => domain.trim().toLowerCase())
          .filter(Boolean),
      )
      .pipe(z.array(z.string()).min(1)),
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
    EMAIL_DELIVERY_ENABLED: z
      .unknown()
      .optional()
      .transform((value, ctx) => {
        try {
          return (
            parseStrictEnvBoolean(value, 'EMAIL_DELIVERY_ENABLED') ?? false
          );
        } catch (error) {
          ctx.addIssue({
            code: 'custom',
            message:
              error instanceof Error
                ? error.message
                : 'Invalid boolean environment value',
          });
          return z.NEVER;
        }
      }),
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
    if (data.CORS_ORIGIN_PATTERNS) {
      if (data.NODE_ENV === 'production') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'CORS_ORIGIN_PATTERNS is not allowed in production',
          path: ['CORS_ORIGIN_PATTERNS'],
        });
      } else {
        try {
          parseCorsOriginPatterns(data.CORS_ORIGIN_PATTERNS);
        } catch (error) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              error instanceof Error
                ? error.message
                : 'Invalid CORS_ORIGIN_PATTERNS',
            path: ['CORS_ORIGIN_PATTERNS'],
          });
        }
      }
    }

    if (data.NODE_ENV === 'production' && !data.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'REDIS_URL is required in production (BullMQ job queues)',
        path: ['REDIS_URL'],
      });
    }

    const hasBullBoardUser = data.BULL_BOARD_USER !== undefined;
    const hasBullBoardPassword = data.BULL_BOARD_PASSWORD !== undefined;
    if (hasBullBoardUser !== hasBullBoardPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'BULL_BOARD_USER and BULL_BOARD_PASSWORD must both be set or both omitted',
        path: hasBullBoardUser ? ['BULL_BOARD_PASSWORD'] : ['BULL_BOARD_USER'],
      });
    }

    if (data.EMAIL_DELIVERY_ENABLED) {
      if (!data.RESEND_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'RESEND_API_KEY is required when EMAIL_DELIVERY_ENABLED=true',
          path: ['RESEND_API_KEY'],
        });
      }
      if (!data.MAIL_FROM) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'MAIL_FROM is required when EMAIL_DELIVERY_ENABLED=true',
          path: ['MAIL_FROM'],
        });
      }
    }

    if (
      (data.AI_GMAIL_CLIENT_ID ||
        data.AI_GMAIL_CLIENT_SECRET ||
        data.AI_GMAIL_REDIRECT_URI) &&
      !data.AI_GMAIL_TOKEN_ENCRYPTION_KEY
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'AI_GMAIL_TOKEN_ENCRYPTION_KEY is required when Gmail OAuth is configured',
        path: ['AI_GMAIL_TOKEN_ENCRYPTION_KEY'],
      });
    }

    // AI provider keys are optional under NODE_ENV=test (CI / e2e).
    if (data.NODE_ENV === 'test') {
      return;
    }

    if (!data.GROQ_API_KEY && !data.OPENROUTER_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'At least one AI provider key is required (GROQ_API_KEY or OPENROUTER_API_KEY)',
        path: ['GROQ_API_KEY'],
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
