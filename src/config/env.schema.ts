import { z } from 'zod';

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

export const envSchema = z
  .object({
    // ── Base de datos ────────────────────────────────────────────
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // ── Supabase ──────────────────────────────────────────────
    SUPABASE_URL: z.url('SUPABASE_URL must be a valid URL'),
    SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z
      .string()
      .min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),

    // ── IA (free-tier providers) ───────────────
    GROQ_API_KEY: optionalApiKey,
    CEREBRAS_API_KEY: optionalApiKey,
    OPENROUTER_API_KEY: optionalApiKey,

    // ── Google OAuth (para Gmail API) ────────────────────────────
    GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
    GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
    GOOGLE_REDIRECT_URI: z.url('GOOGLE_REDIRECT_URI must be a valid URL'),

    ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 chars'),
    OAUTH_STATE_SECRET: z
      .string()
      .min(32, 'OAUTH_STATE_SECRET must be at least 32 chars')
      .optional(),

    // ── App ──────────────────────────────────────────────────────
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),

    PORT: z.coerce.number().int().positive().default(3000),
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
        { message: 'CORS_ORIGIN must be one or more valid URLs separated by commas' },
      ),
    API_URL: z.url('API_URL must be a valid URL'),
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
    DATABASE_SSL_REJECT_UNAUTHORIZED: z.coerce.boolean().optional(),
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
  })
  .superRefine((data, ctx) => {
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
  });


export type Env = z.infer<typeof envSchema>;
