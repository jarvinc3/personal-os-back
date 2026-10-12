import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appVersion } from './app-version';

describe('appVersion', () => {
  it('reads the version from the root package.json', () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { version: string };

    expect(appVersion()).toBe(pkg.version);
  });
});
