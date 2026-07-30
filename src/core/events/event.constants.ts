export const AppEvents = {
  // ── User ──────────────────────────────────────────────
  USER_LOGGED_IN: 'user.logged_in',

  // ── Transaction ──────────────────────────────────────────────
  TRANSACTION_CREATED: 'transaction.created',
  TRANSACTION_UPDATED: 'transaction.updated',

  // ── Budget ──────────────────────────────────────────────
  BUDGET_THRESHOLD_REACHED: 'budget.threshold_reached',

  // ── Notification ──────────────────────────────────────────────
  NOTIFICATION_CREATED: 'notification.created',

  // ── Preferences / modules (non-finance) ─────────────
  USER_PREFERENCES_UPDATED: 'user.preferences.updated',
  MODULE_ENABLED: 'module.enabled',
  MODULE_DISABLED: 'module.disabled',
  MODULE_CONFIG_UPDATED: 'module.config.updated',
} as const;

export type AppEventName = (typeof AppEvents)[keyof typeof AppEvents];
