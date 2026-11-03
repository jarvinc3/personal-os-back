import { createSettingsDescriptor } from './module-settings';

describe('createSettingsDescriptor', () => {
  it('normalizes stored config and applies nested patches over its defaults', () => {
    const descriptor = createSettingsDescriptor({
      slug: 'sample',
      version: 1,
      defaults: {
        version: 1,
        panel: { compact: false, density: 'comfortable' },
        notifications: { weekly: true },
      },
    });

    expect(descriptor.normalize({ panel: { compact: true } })).toEqual({
      version: 1,
      panel: { compact: true, density: 'comfortable' },
      notifications: { weekly: true },
    });
    expect(
      descriptor.applyPatch(
        { panel: { compact: true }, notifications: { weekly: false } },
        { panel: { density: 'compact' } },
      ),
    ).toEqual({
      version: 1,
      panel: { compact: true, density: 'compact' },
      notifications: { weekly: false },
    });
  });

  it('lets the module validate its config and keeps notification opt-outs generic', () => {
    const descriptor = createSettingsDescriptor({
      slug: 'sample',
      version: 1,
      defaults: { notifications: { weekly: true } },
      validate(config) {
        if (typeof config.limit !== 'number') {
          throw new Error('limit is required');
        }
      },
    });

    expect(() => descriptor.normalize({})).toThrow('limit is required');
    expect(
      descriptor.notificationEnabled(
        { notifications: { weekly: false } },
        'weekly',
      ),
    ).toBe(false);
  });
});
