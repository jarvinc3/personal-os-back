import { DEFAULT_EMAIL_SYNC_SCHEDULE } from '@personal-os/config';

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
} as const;

export type FinanceNotificationKey =
  (typeof FINANCE_NOTIFICATION_KEYS)[keyof typeof FINANCE_NOTIFICATION_KEYS];

export const DEFAULT_MODULE_CONFIG_BY_SLUG = {
  finance: {
    version: 2,
    fieldGuide:
      'Moneda, calendario financiero, panel y alertas del módulo Finanzas.',
    baseCurrency: 'DOP',
    trackedCurrencies: ['USD', 'EUR'],
    weekStartsOn: 1,
    dashboardPeriod: 'month',
    display: { showCents: true, compactNumbers: false },
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
    },
    subscriptions: {
      /** Default days before a renewal the reminder fires; each one can override. */
      reminderDaysBefore: 3,
      groupBy: 'none',
    },
    emailSync: {
      enabled: false,
      automatic: false,
      autoCategorize: true,
      schedule: DEFAULT_EMAIL_SYNC_SCHEDULE,
    },
    reports: {
      /** 0 = Sunday … 6 = Saturday, in the user's timezone. */
      weeklySummaryDay: 1,
    },
  },
  agenda: {
    version: 1,
    fieldGuide:
      'Vistas de calendario, horario laboral y recordatorios de eventos.',
    defaultView: 'week',
    weekStartsOn: 1,
    workingHours: { enabled: true, start: '09:00', end: '18:00' },
    defaultReminderMinutes: 15,
    notifications: { eventReminders: true, dailyAgenda: false },
  },
  projects: {
    version: 1,
    fieldGuide: 'Vista y orden por defecto del módulo Proyectos.',
    defaultView: 'board',
    sortBy: 'updatedAt',
    sortDirection: 'desc',
    showArchived: false,
    notifications: { dueDateReminders: true, statusChanges: false },
  },
  health: {
    version: 1,
    fieldGuide: 'Unidades, periodo del panel y alertas de metas.',
    units: 'metric',
    dashboardPeriod: 'week',
    privacy: { hideSensitiveMetrics: false },
    notifications: { goalReminders: true, weeklySummary: false },
  },
} as const;

export type ModuleSlug = keyof typeof DEFAULT_MODULE_CONFIG_BY_SLUG;

export const MODULE_SLUGS = Object.keys(
  DEFAULT_MODULE_CONFIG_BY_SLUG,
) as ModuleSlug[];

export function isModuleSlug(slug: string): slug is ModuleSlug {
  return MODULE_SLUGS.includes(slug as ModuleSlug);
}
