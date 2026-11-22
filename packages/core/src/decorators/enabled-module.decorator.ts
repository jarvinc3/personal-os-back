import { SetMetadata } from '@nestjs/common';
import type { CustomDecorator } from '@nestjs/common';

export const ENABLED_MODULE_KEY = 'enabledModule';

/** Require the JWT user to have this module slug enabled (`user_modules.isEnabled`). */
export function RequiresEnabledModule(slug: string): CustomDecorator {
  return SetMetadata(ENABLED_MODULE_KEY, slug);
}
