/** Hard cap on LLM email extractions per Gmail sync (rest wait for next sync). */
export const DEFAULT_MAX_EMAIL_LLM_EXTRACTS = 25;

export function resolveMaxEmailLlmExtracts(
  envValue: string | undefined = process.env.MAX_EMAIL_LLM_EXTRACTS,
): number {
  if (envValue === undefined || envValue.trim() === '') {
    return DEFAULT_MAX_EMAIL_LLM_EXTRACTS;
  }
  const parsed = Number.parseInt(envValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MAX_EMAIL_LLM_EXTRACTS;
  }
  return parsed;
}

/** Max proactive insight LLM calls per user per UTC day. */
export const DEFAULT_DAILY_INSIGHT_QUOTA = 20;

export function resolveDailyInsightQuota(
  envValue: string | undefined = process.env.AI_DAILY_INSIGHT_QUOTA,
): number {
  if (envValue === undefined || envValue.trim() === '') {
    return DEFAULT_DAILY_INSIGHT_QUOTA;
  }
  const parsed = Number.parseInt(envValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_DAILY_INSIGHT_QUOTA;
  }
  return parsed;
}
