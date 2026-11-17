import { createSettingsDescriptor } from '@personal-os/contracts';

export const PROJECTS_SETTINGS_DESCRIPTOR = createSettingsDescriptor({
  slug: 'projects',
  version: 1,
  defaults: {
    version: 1,
    fieldGuide: 'Vista y orden por defecto de la app Proyectos.',
    defaultView: 'board',
    sortBy: 'updatedAt',
    sortDirection: 'desc',
    showArchived: false,
    notifications: { dueDateReminders: true, statusChanges: false },
  },
});
