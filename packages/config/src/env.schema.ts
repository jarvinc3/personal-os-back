import { z } from 'zod';
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
const defaultedPositiveInt = (fallback: number) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.coerce.number().int().positive().default(fallback),
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

    // ── IA (free-tier providers) ───────────────
    GROQ_API_KEY: optionalApiKey,
    CEREBRAS_API_KEY: optionalApiKey,
    OPENROUTER_API_KEY: optionalApiKey,
    /** Hard cap on LLM email extractions per Gmail sync. Default 25. */
    MAX_EMAIL_LLM_EXTRACTS: defaultedPositiveInt(25),
    /** Max proactive insight LLM calls per user per UTC day. Default 20. */
    AI_DAILY_INSIGHT_QUOTA: defaultedPositiveInt(20),

    // ── Google OAuth (para Gmail API) ────────────────────────────
    GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
    GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
    GOOGLE_REDIRECT_URI: z.url('GOOGLE_REDIRECT_URI must be a valid URL'),

    ENCRYPTION_KEY: z
      .string()
      .min(32, 'ENCRYPTION_KEY must be at least 32 chars'),
    OAUTH_STATE_SECRET: z
      .string()
      .min(32, 'OAUTH_STATE_SECRET must be at least 32 chars')
      .optional(),

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

    // ── Push (Expo + Web Push) ───────────────────────────────────
    EXPO_ACCESS_TOKEN: optionalApiKey,
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
    if (data.NODE_ENV === 'production' && !data.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'REDIS_URL is required in production (BullMQ job queues)',
        path: ['REDIS_URL'],
      });
    }

    if (data.NODE_ENV === 'production' && !data.OAUTH_STATE_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'OAUTH_STATE_SECRET is required in production (must differ from ENCRYPTION_KEY)',
        path: ['OAUTH_STATE_SECRET'],
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

    // AI provider keys are optional under NODE_ENV=test (CI / e2e).
    if (data.NODE_ENV === 'test') {
      return;
    }

    if (
      !data.GROQ_API_KEY &&
      !data.CEREBRAS_API_KEY &&
      !data.OPENROUTER_API_KEY
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'At least one AI provider key is required (GROQ_API_KEY, CEREBRAS_API_KEY, or OPENROUTER_API_KEY)',
        path: ['GROQ_API_KEY'],
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
