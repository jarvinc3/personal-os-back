import { createSettingsDescriptor } from '@personal-os/contracts';
import { DEFAULT_MODULE_CONFIG_BY_SLUG } from '@personal-os/users';

export const AGENDA_SETTINGS_DESCRIPTOR = createSettingsDescriptor({
  slug: 'agenda',
  version: 1,
  defaults: DEFAULT_MODULE_CONFIG_BY_SLUG.agenda,
});
