import {
  createSettingsDescriptor,
  MODULE_SETTINGS_REGISTRY,
} from '@personal-os/contracts';
import { PrismaService } from '@personal-os/database';
import { Test } from '@nestjs/testing';
import { ModuleSettingsService } from './module-settings.service';

describe('ModuleSettingsService', () => {
  const descriptor = createSettingsDescriptor({
    slug: 'sample',
    version: 2,
    defaults: { version: 2, notifications: { digest: true } },
  });

  it('reads a registered module config through the generic UserModule adapter', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      isEnabled: true,
      config: { notifications: { digest: false } },
    });
    const registry = { get: jest.fn().mockReturnValue(descriptor) };
    const module = await Test.createTestingModule({
      providers: [
        ModuleSettingsService,
        {
          provide: PrismaService,
          useValue: { userModule: { findFirst } },
        },
        { provide: MODULE_SETTINGS_REGISTRY, useValue: registry },
      ],
    }).compile();
    const service = module.get(ModuleSettingsService);

    await expect(service.read('user-1', 'sample')).resolves.toEqual({
      enabled: true,
      version: 2,
      config: { version: 2, notifications: { digest: false } },
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', module: { slug: 'sample' } },
      select: { isEnabled: true, config: true },
    });
  });

  it('returns descriptor defaults for users without a UserModule row', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        ModuleSettingsService,
        {
          provide: PrismaService,
          useValue: { userModule: { findFirst } },
        },
        {
          provide: MODULE_SETTINGS_REGISTRY,
          useValue: { get: jest.fn().mockReturnValue(descriptor) },
        },
      ],
    }).compile();

    await expect(
      module.get(ModuleSettingsService).read('user-1', 'sample'),
    ).resolves.toEqual({
      enabled: false,
      version: 2,
      config: { version: 2, notifications: { digest: true } },
    });
  });

  it('delegates whether a descriptor is registered to the registry', () => {
    const has = jest.fn().mockReturnValue(true);
    const service = new ModuleSettingsService({} as never, { has } as never);

    expect(service.has('sample')).toBe(true);
    expect(has).toHaveBeenCalledWith('sample');
  });
});
