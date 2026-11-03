import { DynamicModule, Module } from '@nestjs/common';
import {
  MODULE_SETTINGS_READER,
  MODULE_SETTINGS_REGISTRY,
  type SettingsDescriptor,
} from '@personal-os/contracts';
import { PrismaModule } from '@personal-os/database';
import { ModuleSettingsRegistry } from './module-settings.registry';
import { ModuleSettingsService } from './module-settings.service';
import { MODULE_SETTINGS_DESCRIPTORS } from './module-settings.tokens';

@Module({})
export class ModuleSettingsModule {
  static register(descriptors: readonly SettingsDescriptor[]): DynamicModule {
    return {
      module: ModuleSettingsModule,
      imports: [PrismaModule],
      providers: [
        { provide: MODULE_SETTINGS_DESCRIPTORS, useValue: descriptors },
        ModuleSettingsRegistry,
        {
          provide: MODULE_SETTINGS_REGISTRY,
          useExisting: ModuleSettingsRegistry,
        },
        ModuleSettingsService,
        {
          provide: MODULE_SETTINGS_READER,
          useExisting: ModuleSettingsService,
        },
      ],
      exports: [MODULE_SETTINGS_READER, MODULE_SETTINGS_REGISTRY],
    };
  }
}
