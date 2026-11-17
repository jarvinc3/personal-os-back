import { createSettingsDescriptor } from '@personal-os/contracts';

export const AGENDA_SETTINGS_DESCRIPTOR = createSettingsDescriptor({
  slug: 'agenda',
  version: 1,
  defaults: {
    version: 1,
    fieldGuide:
      'Vistas de calendario, horario laboral y recordatorios de eventos.',
    defaultView: 'week',
    weekStartsOn: 1,
    workingHours: { enabled: true, start: '09:00', end: '18:00' },
    defaultReminderMinutes: 15,
    notifications: { eventReminders: true, dailyAgenda: false },
  },
});
