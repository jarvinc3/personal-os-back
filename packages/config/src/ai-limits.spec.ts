import {
  DEFAULT_DAILY_INSIGHT_QUOTA,
  DEFAULT_MAX_EMAIL_LLM_EXTRACTS,
  resolveDailyInsightQuota,
  resolveMaxEmailLlmExtracts,
} from './ai-limits';

describe('ai-limits', () => {
  it('defaults max email LLM extracts to 25', () => {
    expect(resolveMaxEmailLlmExtracts(undefined)).toBe(
      DEFAULT_MAX_EMAIL_LLM_EXTRACTS,
    );
    expect(resolveMaxEmailLlmExtracts('')).toBe(DEFAULT_MAX_EMAIL_LLM_EXTRACTS);
    expect(resolveMaxEmailLlmExtracts('0')).toBe(DEFAULT_MAX_EMAIL_LLM_EXTRACTS);
    expect(resolveMaxEmailLlmExtracts('10')).toBe(10);
  });

  it('defaults daily insight quota to 20', () => {
    expect(resolveDailyInsightQuota(undefined)).toBe(DEFAULT_DAILY_INSIGHT_QUOTA);
    expect(resolveDailyInsightQuota('abc')).toBe(DEFAULT_DAILY_INSIGHT_QUOTA);
    expect(resolveDailyInsightQuota('5')).toBe(5);
  });
});
