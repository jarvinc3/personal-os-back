import { z } from 'zod';
import type { NodeEnvironment } from './env-helpers';
import { parseCorsOriginPatterns } from './cors-origins';

type GmailSettings = {
  gmailConfigured: boolean;
};

/**
 * Cross-field rules the environment schema applies after parsing. Each one
 * reads only the values it checks, so the schema stays a list of fields plus
 * this orchestration.
 */
export function checkCorsOriginPatterns(
  {
    nodeEnv,
    patterns,
  }: {
    nodeEnv: NodeEnvironment;
    patterns: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (!patterns) {
    return;
  }
  if (nodeEnv === 'production') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'CORS_ORIGIN_PATTERNS is not allowed in production',
      path: ['CORS_ORIGIN_PATTERNS'],
    });
    return;
  }
  try {
    parseCorsOriginPatterns(patterns);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        error instanceof Error ? error.message : 'Invalid CORS_ORIGIN_PATTERNS',
      path: ['CORS_ORIGIN_PATTERNS'],
    });
  }
}

export function requireRedisInProduction(
  {
    nodeEnv,
    redisUrl,
  }: {
    nodeEnv: NodeEnvironment;
    redisUrl: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (nodeEnv === 'production' && !redisUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'REDIS_URL is required in production (BullMQ job queues)',
      path: ['REDIS_URL'],
    });
  }
}

export function checkBullBoardCredentials(
  {
    user,
    password,
  }: {
    user: string | undefined;
    password: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const hasUser = user !== undefined;
  const hasPassword = password !== undefined;
  if (hasUser !== hasPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'BULL_BOARD_USER and BULL_BOARD_PASSWORD must both be set or both omitted',
      path: hasUser ? ['BULL_BOARD_PASSWORD'] : ['BULL_BOARD_USER'],
    });
  }
}

export function requireEmailDeliveryDependencies(
  {
    enabled,
    resendApiKey,
    mailFrom,
  }: {
    enabled: boolean;
    resendApiKey: string | undefined;
    mailFrom: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (!enabled) {
    return;
  }
  if (!resendApiKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'RESEND_API_KEY is required when EMAIL_DELIVERY_ENABLED=true',
      path: ['RESEND_API_KEY'],
    });
  }
  if (!mailFrom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'MAIL_FROM is required when EMAIL_DELIVERY_ENABLED=true',
      path: ['MAIL_FROM'],
    });
  }
}

export function checkGmailEncryptionKey(
  {
    gmailConfigured,
    tokenKey,
  }: GmailSettings & { tokenKey: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (gmailConfigured && !tokenKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'AI_GMAIL_TOKEN_ENCRYPTION_KEY is required when Gmail OAuth is configured',
      path: ['AI_GMAIL_TOKEN_ENCRYPTION_KEY'],
    });
  }
}

export function checkOAuthStateSecret(
  {
    nodeEnv,
    gmailConfigured,
    stateSecret,
  }: GmailSettings & {
    nodeEnv: NodeEnvironment;
    stateSecret: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if ((nodeEnv === 'production' || gmailConfigured) && !stateSecret) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'OAUTH_STATE_SECRET is required in production and when Gmail OAuth is configured',
      path: ['OAUTH_STATE_SECRET'],
    });
  }
}

export function checkOAuthKeysDiffer(
  {
    stateSecret,
    tokenKey,
  }: {
    stateSecret: string | undefined;
    tokenKey: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (stateSecret && tokenKey && stateSecret === tokenKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'OAUTH_STATE_SECRET must differ from AI_GMAIL_TOKEN_ENCRYPTION_KEY',
      path: ['OAUTH_STATE_SECRET'],
    });
  }
}

/** AI provider keys are optional under NODE_ENV=test (CI / e2e). */
export function checkAiProviderKey(
  {
    nodeEnv,
    groqKey,
    openrouterKey,
  }: {
    nodeEnv: NodeEnvironment;
    groqKey: string | undefined;
    openrouterKey: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (nodeEnv === 'test') {
    return;
  }
  if (!groqKey && !openrouterKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'At least one AI provider key is required (GROQ_API_KEY or OPENROUTER_API_KEY)',
      path: ['GROQ_API_KEY'],
    });
  }
}
