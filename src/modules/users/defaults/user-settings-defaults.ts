export const DEFAULT_MODULE_CONFIG_BY_SLUG = {
  finance: {
    version: 1,
    fieldGuide: 'Moneda, calendario financiero, panel y alertas del módulo Finanzas.',
    baseCurrency: 'DOP',
    weekStartsOn: 1,
    dashboardPeriod: 'month',
    display: { showCents: true, compactNumbers: false },
    notifications: {
      budgetAlerts: true,
      aiSuggestions: true,
      transactionDetected: true,
      monthlyReport: false,
      cardDueDate: true,
      unusualExpense: true,
    },
    emailSync: { enabled: false, autoCategorize: true },
  },
  agenda: {
    version: 1,
    fieldGuide: 'Vistas de calendario, horario laboral y recordatorios de eventos.',
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
  subscriptions: {
    version: 1,
    fieldGuide: 'Moneda, agrupación y avisos de renovación.',
    defaultCurrency: 'DOP',
    renewalReminderDays: [7, 1],
    groupBy: 'category',
    notifications: { renewalReminders: true, priceIncreaseAlerts: true },
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

export const MODULE_SLUGS = Object.keys(DEFAULT_MODULE_CONFIG_BY_SLUG) as ModuleSlug[];

export function isModuleSlug(slug: string): slug is ModuleSlug {
  return MODULE_SLUGS.includes(slug as ModuleSlug);
}
