import * as Sentry from '@sentry/nestjs';
import { scrubSentryEvent } from '@personal-os/core';
import { appVersion } from './app-version';

const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

/**
 * Sentry is opt-in: without `SENTRY_DSN` the SDK is never initialized, so
 * tests, CI, and local runs stay a no-op. This module runs before Nest reads
 * the environment, so it reads `process.env` directly.
 */
function resolveTracesSampleRate(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return DEFAULT_TRACES_SAMPLE_RATE;
  }
  return parsed;
}

const dsn = process.env.SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: appVersion(),
    tracesSampleRate: resolveTracesSampleRate(
      process.env.SENTRY_TRACES_SAMPLE_RATE,
    ),
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
  });
}
