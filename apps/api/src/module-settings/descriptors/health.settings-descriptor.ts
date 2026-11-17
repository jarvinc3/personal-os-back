import { createSettingsDescriptor } from '@personal-os/contracts';

export const HEALTH_SETTINGS_DESCRIPTOR = createSettingsDescriptor({
  slug: 'health',
  version: 1,
  defaults: {
    version: 1,
    fieldGuide: 'Unidades, periodo del panel y alertas de metas.',
    units: 'metric',
    dashboardPeriod: 'week',
    privacy: { hideSensitiveMetrics: false },
    notifications: { goalReminders: true, weeklySummary: false },
  },
});
