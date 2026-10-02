# Infraestructura

Núcleo transversal. El dominio vive en `docs/modules/`.

| Documento | Código |
| --- | --- |
| [overview.md](./overview.md) | `packages/core/src`, `packages/config/src` |
| [config.md](./config.md) | `packages/config/src/env.schema.ts` |
| [health.md](./health.md) | `apps/api/src/health` |
| [events-and-queues.md](./events-and-queues.md) | `event.constants.ts`, `QueueNames` |
| [database.md](./database.md) | `prisma/`, `packages/database/src` |
| [websocket.md](./websocket.md) | `NotificationsGateway` |
| [security.md](./security.md) | Helmet, JWT JWKS, production checklist |
| [errors-and-envelope.md](./errors-and-envelope.md) | `TransformInterceptor`, `AllExceptionsFilter` |
