import { HttpHealthIndicator } from '@nestjs/terminus';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { BRAND_LOGO, LOGO_STORAGE } from '@personal-os/logos';

export function applyExternalTestOverrides(
  builder: TestingModuleBuilder,
): TestingModuleBuilder {
  return builder
    .overrideProvider(LOGO_STORAGE)
    .useValue({
      isAvailable: () => false,
      exists: jest.fn().mockResolvedValue(false),
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      publicUrl: jest.fn((path: string) => `/test-logos/${path}`),
    })
    .overrideProvider(BRAND_LOGO)
    .useValue({
      search: jest.fn().mockResolvedValue([]),
      download: jest.fn().mockResolvedValue({ kind: 'unavailable' }),
    })
    .overrideProvider(HttpHealthIndicator)
    .useValue({
      pingCheck: jest
        .fn()
        .mockImplementation((key: string) =>
          Promise.resolve({ [key]: { status: 'up' } }),
        ),
    });
}
