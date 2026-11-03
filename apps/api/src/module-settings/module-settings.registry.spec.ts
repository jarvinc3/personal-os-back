import { createSettingsDescriptor } from '@personal-os/contracts';
import { ModuleSettingsRegistry } from './module-settings.registry';

describe('ModuleSettingsRegistry', () => {
  it('registers a test module and provides generic normalize and patch operations', () => {
    const registry = new ModuleSettingsRegistry([
      createSettingsDescriptor({
        slug: 'test-module',
        version: 3,
        defaults: { version: 3, view: 'list', notifications: { digest: true } },
      }),
    ]);

    expect(registry.normalize('test-module', { view: 'board' })).toEqual({
      version: 3,
      view: 'board',
      notifications: { digest: true },
    });
    expect(
      registry.applyPatch(
        'test-module',
        { view: 'board' },
        { view: 'calendar' },
      ),
    ).toMatchObject({ view: 'calendar' });
    expect(registry.list()).toHaveLength(1);
  });

  it('rejects duplicate slugs and unregistered modules', () => {
    const descriptor = createSettingsDescriptor({
      slug: 'same',
      version: 1,
      defaults: {},
    });
    const registry = new ModuleSettingsRegistry([descriptor]);

    expect(() => registry.register(descriptor)).toThrow(
      'Settings descriptor already registered: same',
    );
    expect(() => registry.get('missing')).toThrow(
      'Settings descriptor not registered: missing',
    );
  });
});
