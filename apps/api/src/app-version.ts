import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const logger = new Logger('AppVersion');

const UNKNOWN_VERSION = '0.0.0';

/** Reads the version from the root `package.json`; throws when it cannot. */
function readPackageVersion(): string {
  const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version ?? UNKNOWN_VERSION;
}

/**
 * The start scripts run from the repo root, so `process.cwd()` points at
 * `package.json`. A missing file only costs the version in Swagger and the
 * health probe, so it is logged and reported as unknown instead of stopping
 * the app.
 */
let appVersionValue = UNKNOWN_VERSION;
try {
  appVersionValue = readPackageVersion();
} catch (error) {
  logger.warn(
    `Could not read package.json for the app version: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

/** Version of the running build. */
export function appVersion(): string {
  return appVersionValue;
}
