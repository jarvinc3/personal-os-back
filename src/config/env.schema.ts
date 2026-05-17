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

    // ── IA (free-tier providers) ───────────────
    GROQ_API_KEY: optionalApiKey,
    CEREBRAS_API_KEY: optionalApiKey,
    OPENROUTER_API_KEY: optionalApiKey,

    // ── Google OAuth (para Gmail API) ────────────────────────────
    GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
    GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
    GOOGLE_REDIRECT_URI: z.url('GOOGLE_REDIRECT_URI must be a valid URL'),

    // ── App ──────────────────────────────────────────────────────
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    CORS_ORIGIN: z.url('CORS_ORIGIN must be a valid URL'),
    API_URL: z.url('API_URL must be a valid URL'),
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
  })
  .superRefine((data, ctx) => {
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
