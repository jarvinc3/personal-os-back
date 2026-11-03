export const AppEvents = {
  // ── User ──────────────────────────────────────────────
  USER_LOGGED_IN: 'user.logged_in',
  USER_ACCOUNT_DELETING: 'user.account.deleting',

  // ── Notification ──────────────────────────────────────────────
  NOTIFICATION_CREATED: 'notification.created',

  // ── AI email synchronization ─────────────────────────────────
  AI_EMAIL_SYNC_UPDATED: 'ai.email.sync.updated',

  // ── Preferences / modules (non-finance) ─────────────
  USER_PREFERENCES_UPDATED: 'user.preferences.updated',
  MODULE_ENABLED: 'module.enabled',
  MODULE_DISABLED: 'module.disabled',
  MODULE_CONFIG_UPDATED: 'module.config.updated',

  // ── Self-service data wipe ─────────────────────────────
  USER_DATA_WIPED: 'user.data.wiped',
} as const;

export type AppEventName = (typeof AppEvents)[keyof typeof AppEvents];
