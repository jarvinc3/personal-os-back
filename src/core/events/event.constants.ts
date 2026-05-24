export const AppEvents = {
  // ── User ──────────────────────────────────────────────
  USER_CREATED: 'user.created',
  USER_LOGGED_IN: 'user.logged_in',

  // ── Transaction ──────────────────────────────────────────────
  TRANSACTION_CREATED: 'transaction.created',
  TRANSACTION_UPDATED: 'transaction.updated',

  // ── Budget ──────────────────────────────────────────────
  BUDGET_THRESHOLD_REACHED: 'budget.threshold_reached',

  // ── AI ──────────────────────────────────────────────
  AI_ACTION_REQUESTED: 'ai.action_requested',
  AI_ACTION_COMPLETED: 'ai.action_completed',

  // ── Preferences / modules (non-finance) ─────────────
  USER_PREFERENCES_UPDATED: 'user.preferences.updated',
  MODULE_ENABLED: 'module.enabled',
  MODULE_DISABLED: 'module.disabled',
  MODULE_CONFIG_UPDATED: 'module.config.updated',
  ONBOARDING_COMPLETED: 'onboarding.completed',
} as const;

export type AppEventName = (typeof AppEvents)[keyof typeof AppEvents];
