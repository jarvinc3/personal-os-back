# Infraestructura

Núcleo transversal. El dominio vive en `docs/modules/`.

| Documento | Código |
| --- | --- |
| [overview.md](./overview.md) | `src/core`, `src/config` |
| [config.md](./config.md) | `src/config/env.schema.ts` |
| [health.md](./health.md) | `src/health` |
| [events-and-queues.md](./events-and-queues.md) | `event.constants.ts`, `QueueNames` |
| [database.md](./database.md) | `prisma/`, `src/prisma` |
| [websocket.md](./websocket.md) | `NotificationsGateway` |
| [security.md](./security.md) | Helmet, JWT JWKS, production checklist |
| [errors-and-envelope.md](./errors-and-envelope.md) | `TransformInterceptor`, `AllExceptionsFilter` |
