# Infraestructura — overview

Núcleo transversal de `personal-os-back` (NestJS 11). Los módulos de dominio están en `packages/*/src/`. Este documento describe el core, no el ledger.

## Stack (VERIFICADO)

| Capa        | Tecnología                                 | Evidencia                                         |
| ----------- | ------------------------------------------ | ------------------------------------------------- |
| Framework   | NestJS 11                                  | `package.json`                                    |
| ORM         | Prisma 7 + PostgreSQL (Supabase)           | `packages/database/prisma/schema.prisma`          |
| Auth        | Supabase JWT vía JWKS                      | `packages/auth/src/infrastructure`                |
| Colas       | BullMQ + Redis (opcional en dev)           | `packages/config/src`, `packages/core/src/queues` |
| Eventos     | `@nestjs/event-emitter` in-process         | `AppEvents`                                       |
| Logs        | Pino (`nestjs-pino`)                       | `package.json`                                    |
| API docs    | Swagger `SWAGGER_PATH` (off en production) | `main.ts`                                         |
| Tiempo real | Socket.IO namespace `/notifications`       | `notifications.gateway.ts`                        |

## `packages/core/src/` (VERIFICADO)

Registrado en `CoreModule`: `JwtAuthGuard`, `EnabledModuleGuard`, `CustomThrottlerGuard`, `IdempotencyInterceptor`, `ClassSerializerInterceptor`, `TransformInterceptor`, `TimeoutInterceptor`, `LoggingInterceptor`, `AllExceptionsFilter`.

Cifrado compartido: `packages/core/src/crypto/aes-gcm.util.ts` (`encryptSecret`, `decryptSecret`, `deriveSecretKey`). Lo usan el número de cuenta de Finanzas y los tokens de Gmail de Inteligencia, así que el formato `iv | tag | ciphertext` y la derivación `sha256(secreto)` viven en un solo lugar.

Normalización `error`/`message`: `packages/core/src/exceptions/http-error.util.ts`. No hay `src/shared/` a nivel raíz.

## Event-driven selectivo

No hay EDA en todo el CRUD. Finance persiste ledger + outbox en la misma `$transaction`; el `OutboxRelay` de Core (cron 30s + wake post-commit) emite `EventEmitter2`. Listeners usan `DomainEventIdempotencyGuard`. Los productores dependen de los ports de `@personal-os/contracts`, no de la infraestructura de Core.

Otros módulos emiten in-process sin outbox: `user.logged_in`, `notification.created`, `user.preferences.updated`, `module.*`.

Catálogo y colas: [events-and-queues.md](./events-and-queues.md).

## Observabilidad

Pino (`nestjs-pino`) con `requestId` en el envelope y Sentry opt-in para errores y trazas. Detalle y variables en [observability.md](./observability.md).

## Relacionado

- [config.md](./config.md) · [health.md](./health.md) · [security.md](./security.md) · [database.md](./database.md)
