import { Inject, Injectable } from '@nestjs/common';
import {
  type ModuleSettingsRegistry as ModuleSettingsRegistryContract,
  type SettingsDescriptor,
} from '@personal-os/contracts';
import { MODULE_SETTINGS_DESCRIPTORS } from './module-settings.tokens';

@Injectable()
export class ModuleSettingsRegistry implements ModuleSettingsRegistryContract {
  private readonly descriptors = new Map<string, SettingsDescriptor>();

  constructor(
    @Inject(MODULE_SETTINGS_DESCRIPTORS)
    descriptors: readonly SettingsDescriptor[],
  ) {
    for (const descriptor of descriptors) {
      this.register(descriptor);
    }
  }

  register(descriptor: SettingsDescriptor): void {
    if (this.descriptors.has(descriptor.slug)) {
      throw new Error(
        `Settings descriptor already registered: ${descriptor.slug}`,
      );
    }
    this.descriptors.set(descriptor.slug, descriptor);
  }

  get(slug: string): SettingsDescriptor {
    const descriptor = this.descriptors.get(slug);
    if (!descriptor) {
      throw new Error(`Settings descriptor not registered: ${slug}`);
    }
    return descriptor;
  }

  has(slug: string): boolean {
    return this.descriptors.has(slug);
  }

  list(): readonly SettingsDescriptor[] {
    return [...this.descriptors.values()];
  }

  normalize(slug: string, stored: unknown) {
    return this.get(slug).normalize(stored);
  }

  applyPatch(slug: string, current: unknown, patch: unknown) {
    const descriptor = this.get(slug);
    return descriptor.applyPatch(descriptor.normalize(current), patch);
  }
}
