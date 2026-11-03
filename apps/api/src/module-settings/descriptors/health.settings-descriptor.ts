import { createSettingsDescriptor } from '@personal-os/contracts';
import { DEFAULT_MODULE_CONFIG_BY_SLUG } from '@personal-os/users';

export const HEALTH_SETTINGS_DESCRIPTOR = createSettingsDescriptor({
  slug: 'health',
  version: 1,
  defaults: DEFAULT_MODULE_CONFIG_BY_SLUG.health,
});
