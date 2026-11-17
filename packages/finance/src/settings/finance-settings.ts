/** Toggle keys under `config.notifications` for finance module alerts. */
export const FINANCE_NOTIFICATION_KEYS = {
  budgetAlerts: 'budgetAlerts',
  aiSuggestions: 'aiSuggestions',
  transactionDetected: 'transactionDetected',
  monthlyReport: 'monthlyReport',
  weeklySummary: 'weeklySummary',
  cardDueDate: 'cardDueDate',
  unusualExpense: 'unusualExpense',
  recurringAlerts: 'recurringAlerts',
  subscriptionReminders: 'subscriptionReminders',
  priceIncreaseAlerts: 'priceIncreaseAlerts',
  balanceIntegrity: 'balanceIntegrity',
} as const;

export type FinanceNotificationKey =
  (typeof FINANCE_NOTIFICATION_KEYS)[keyof typeof FINANCE_NOTIFICATION_KEYS];

export const FINANCE_SETTINGS_DEFAULTS = {
  version: 2,
  fieldGuide:
    'Moneda, calendario financiero, panel y alertas de la app Finanzas.',
  baseCurrency: 'DOP',
  trackedCurrencies: ['USD', 'EUR'],
  weekStartsOn: 1,
  dashboardPeriod: 'month',
  display: { showCents: true, compactNumbers: false },
  reminders: {
    /** Days before a card payment due date the user gets a heads-up. */
    cardDueDaysBefore: 3,
  },
  notifications: {
    [FINANCE_NOTIFICATION_KEYS.budgetAlerts]: true,
    [FINANCE_NOTIFICATION_KEYS.aiSuggestions]: true,
    [FINANCE_NOTIFICATION_KEYS.transactionDetected]: true,
    [FINANCE_NOTIFICATION_KEYS.monthlyReport]: false,
    [FINANCE_NOTIFICATION_KEYS.weeklySummary]: true,
    [FINANCE_NOTIFICATION_KEYS.cardDueDate]: true,
    [FINANCE_NOTIFICATION_KEYS.unusualExpense]: true,
    [FINANCE_NOTIFICATION_KEYS.recurringAlerts]: true,
    [FINANCE_NOTIFICATION_KEYS.subscriptionReminders]: true,
    [FINANCE_NOTIFICATION_KEYS.priceIncreaseAlerts]: true,
    [FINANCE_NOTIFICATION_KEYS.balanceIntegrity]: true,
  },
  subscriptions: {
    /**
     * Days before a renewal the user gets a heads-up: renewal reminders and
     * the "next charges" window of the Suscripciones view.
     */
    reminderDaysBefore: 5,
    groupBy: 'none',
  },
  reports: {
    /** 0 = Sunday … 6 = Saturday, in the user's timezone. */
    weeklySummaryDay: 1,
  },
} as const;

/** Allowed range for the `subscriptions.reminderDaysBefore` setting. */
export const SUBSCRIPTION_REMINDER_DAYS_MIN = 1;
export const SUBSCRIPTION_REMINDER_DAYS_MAX = 30;

/** Allowed range for the `reminders.cardDueDaysBefore` setting. */
export const CARD_DUE_DAYS_BEFORE_MIN = 0;
export const CARD_DUE_DAYS_BEFORE_MAX = 30;

/**
 * Warning window before a card payment due date, read from a user module
 * config that may be partial.
 */
export function resolveCardDueDaysBefore(config: unknown): number {
  const settings = config as
    { reminders?: { cardDueDaysBefore?: unknown } } | null | undefined;
  const value = settings?.reminders?.cardDueDaysBefore;
  return typeof value === 'number'
    ? value
    : FINANCE_SETTINGS_DEFAULTS.reminders.cardDueDaysBefore;
}

/** Message when the setting is out of range, or null when it is valid. */
export function validateCardDueDaysBefore(value: unknown): string | null {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < CARD_DUE_DAYS_BEFORE_MIN ||
    value > CARD_DUE_DAYS_BEFORE_MAX
  ) {
    return `reminders.cardDueDaysBefore must be an integer between ${CARD_DUE_DAYS_BEFORE_MIN} and ${CARD_DUE_DAYS_BEFORE_MAX}`;
  }
  return null;
}

/**
 * Window in days for upcoming-charge warnings, read from a user module config
 * that may be partial.
 */
export function resolveSubscriptionReminderDays(config: unknown): number {
  const settings = config as
    { subscriptions?: { reminderDaysBefore?: unknown } } | null | undefined;
  const value = settings?.subscriptions?.reminderDaysBefore;
  return typeof value === 'number'
    ? value
    : FINANCE_SETTINGS_DEFAULTS.subscriptions.reminderDaysBefore;
}

/** Message when the setting is out of range, or null when it is valid. */
export function validateSubscriptionReminderDays(
  value: unknown,
): string | null {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < SUBSCRIPTION_REMINDER_DAYS_MIN ||
    value > SUBSCRIPTION_REMINDER_DAYS_MAX
  ) {
    return `subscriptions.reminderDaysBefore must be an integer between ${SUBSCRIPTION_REMINDER_DAYS_MIN} and ${SUBSCRIPTION_REMINDER_DAYS_MAX}`;
  }
  return null;
}
