export const AppEvents = {
  // ── User ──────────────────────────────────────────────
  USER_LOGGED_IN: 'user.logged_in',

  // ── Finance (versioned only) ──────────────────────────
  FINANCE_TRANSACTION_IMPORTED: 'finance.transaction.imported',
  FINANCE_TRANSACTION_CONFIRMED: 'finance.transaction.confirmed',
  FINANCE_TRANSACTION_UPDATED: 'finance.transaction.updated',
  FINANCE_TRANSACTION_DECLINED: 'finance.transaction.declined',
  FINANCE_TRANSACTION_CANCELLED: 'finance.transaction.cancelled',
  FINANCE_TRANSACTION_REVERSED: 'finance.transaction.reversed',
  FINANCE_TRANSACTION_DELETED: 'finance.transaction.deleted',
  FINANCE_TRANSFER_CREATED: 'finance.transfer.created',
  FINANCE_BUDGET_THRESHOLD_CROSSED: 'finance.budget.threshold_crossed',
  FINANCE_EMAIL_SYNC_COMPLETED: 'finance.email_sync.completed',
  FINANCE_EMAIL_SYNC_FAILED: 'finance.email_sync.failed',
  FINANCE_CARD_STATEMENT_REMINDER: 'finance.card_statement.reminder',
  FINANCE_WEEKLY_SUMMARY: 'finance.weekly_summary',

  // ── Notification ──────────────────────────────────────────────
  NOTIFICATION_CREATED: 'notification.created',

  // ── Preferences / modules (non-finance) ─────────────
  USER_PREFERENCES_UPDATED: 'user.preferences.updated',
  MODULE_ENABLED: 'module.enabled',
  MODULE_DISABLED: 'module.disabled',
  MODULE_CONFIG_UPDATED: 'module.config.updated',

  // ── Self-service data wipe ─────────────────────────────
  USER_DATA_WIPED: 'user.data.wiped',
} as const;

export type AppEventName = (typeof AppEvents)[keyof typeof AppEvents];
