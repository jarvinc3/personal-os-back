# Observabilidad

## Sentry

Opt-in: sin `SENTRY_DSN` la SDK no se inicializa. `apps/api/src/instrument.ts` lee `process.env` directamente antes de que Nest lea el entorno. `beforeSend` y `beforeSendTransaction` pasan por `scrubSentryEvent` (`packages/core/src/observability/sentry-scrubber.ts`) para quitar datos sensibles. `AllExceptionsFilter` reporta los errores (`reportToSentry`).

Variables opcionales (`packages/config/src/env.schema.ts`): `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` (0–1, default 0.1), `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`.

Source maps: `pnpm sentry:sourcemaps` (`scripts/sentry/upload-sourcemaps.mjs`) sube los de `dist` con `@sentry/cli` cuando existe `SENTRY_AUTH_TOKEN`; sin token no hace nada y el build no falla. `pnpm build` lo ejecuta al final.

## Logs

Pino (`nestjs-pino`) con `requestId` en el envelope. Fallos de workers Bull vía `@OnWorkerEvent('failed')`.

Los fallos de proveedores de IA registran una línea por intento con proveedor, modelo, estado HTTP, reintento, fallback y causa; el mensaje se sanea, se trunca y omite el cuerpo del proveedor.
