import { createSettingsDescriptor } from '@personal-os/contracts';
import { DEFAULT_MODULE_CONFIG_BY_SLUG } from '@personal-os/users';

export const PROJECTS_SETTINGS_DESCRIPTOR = createSettingsDescriptor({
  slug: 'projects',
  version: 1,
  defaults: DEFAULT_MODULE_CONFIG_BY_SLUG.projects,
});
