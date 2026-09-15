# Infraestructura — overview

Núcleo transversal de `personal-os-back` (NestJS 11). Los módulos de dominio están en `src/modules/`. Este documento describe el core, no el ledger.

## Stack (VERIFICADO)

| Capa | Tecnología | Evidencia |
| --- | --- | --- |
| Framework | NestJS 11 | `package.json` |
| ORM | Prisma 7 + PostgreSQL (Supabase) | `prisma/schema.prisma` |
| Auth | Supabase JWT vía JWKS | `src/modules/auth/infrastructure` |
| Colas | BullMQ + Redis (opcional en dev) | `src/config`, `src/core/queues` |
| Eventos | `@nestjs/event-emitter` in-process | `AppEvents` |
| Logs | Pino (`nestjs-pino`) | `package.json` |
| API docs | Swagger `SWAGGER_PATH` (off en production) | `main.ts` |
| Tiempo real | Socket.IO namespace `/notifications` | `notifications.gateway.ts` |

## `src/core/` (VERIFICADO)

Registrado en `CoreModule`: `JwtAuthGuard`, `EnabledModuleGuard`, `CustomThrottlerGuard`, `ClassSerializerInterceptor`, `TransformInterceptor`, `TimeoutInterceptor`, `AiMetricsInterceptor`, `AllExceptionsFilter`.

> [!WARNING]
> **REV-BACK-001** (`NO_IMPLEMENTADO`) — `LoggingInterceptor` y `RolesGuard` existen como archivos pero no están registrados como `APP_*`. Detalle: [review-register.md](../review-register.md#rev-back-001)

Normalización `error`/`message`: `src/core/exceptions/http-error.util.ts`. No hay `src/shared/` a nivel raíz.

## Event-driven selectivo

No hay EDA en todo el CRUD. Finance persiste ledger + outbox en la misma `$transaction`; `FinanceOutboxDispatcher` (cron 30s + wake post-commit) emite `EventEmitter2`. Listeners usan `DomainEventIdempotencyGuard`.

Otros módulos emiten in-process sin outbox: `user.logged_in`, `notification.created`, `user.preferences.updated`, `module.*`.

Catálogo y colas: [events-and-queues.md](./events-and-queues.md).

## Observabilidad

Pino + `requestId` en el envelope. Fallos de workers Bull vía `@OnWorkerEvent('failed')`.

## Relacionado

- [config.md](./config.md) · [health.md](./health.md) · [security.md](./security.md) · [database.md](./database.md)
