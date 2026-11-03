# Infraestructura

Núcleo transversal. El dominio vive en `docs/modules/`.

| Documento                                          | Código                                               |
| -------------------------------------------------- | ---------------------------------------------------- |
| [overview.md](./overview.md)                       | `packages/core/src`, `packages/config/src`           |
| [config.md](./config.md)                           | `packages/config/src/env.schema.ts`                  |
| [health.md](./health.md)                           | `apps/api/src/health`                                |
| [events-and-queues.md](./events-and-queues.md)     | `event.constants.ts`, `QueueNames`                   |
| [module-settings.md](./module-settings.md)         | `apps/api/src/module-settings`, `SettingsDescriptor` |
| [database.md](./database.md)                       | `prisma/`, `packages/database/src`                   |
| [websocket.md](./websocket.md)                     | `NotificationsGateway`                               |
| [security.md](./security.md)                       | Helmet, JWT JWKS, production checklist               |
| [observability.md](./observability.md)             | Sentry y source maps                                 |
| [errors-and-envelope.md](./errors-and-envelope.md) | `TransformInterceptor`, `AllExceptionsFilter`        |
