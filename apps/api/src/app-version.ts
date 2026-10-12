import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const logger = new Logger('AppVersion');

const UNKNOWN_VERSION = '0.0.0';

let cachedVersion: string | null = null;

/**
 * Version of the running build, read from the root `package.json` once. The
 * start scripts run from the repo root, so `process.cwd()` points at it. A
 * missing file only costs the version in Swagger and the health probe, so it
 * is logged and reported as unknown instead of stopping the app.
 */
export function appVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }
  try {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    cachedVersion = parsed.version ?? UNKNOWN_VERSION;
  } catch (error) {
    logger.warn(
      `Could not read package.json for the app version: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    cachedVersion = UNKNOWN_VERSION;
  }
  return cachedVersion;
}
