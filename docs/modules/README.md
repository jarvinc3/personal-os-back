# Módulos (backend)

Cada fila es un módulo Nest en `src/modules/`.

| Módulo | Código | Doc | Estilo |
| --- | --- | --- | --- |
| Auth | `src/modules/auth/` | [auth/](./auth/README.md) | Simple |
| Users | `src/modules/users/` | [users/](./users/README.md) | Simple |
| Notifications | `src/modules/notifications/` | [notifications/](./notifications/README.md) | Simple |
| AI Agent | `src/modules/ai-agent/` | [ai-agent/](./ai-agent/README.md) | Complejo (capabilities) |
| Finance | `src/modules/finance/` | [finance/](./finance/README.md) | Complejo + submódulos Nest |

Estándar de carpetas: [architecture/modules.md](../architecture/modules.md).

## No son módulos Nest

`agenda`, `projects`, `health`, `subscriptions` — slugs en `MODULE_SLUGS` / `user_modules`. Tools de contexto existen en `MODULE_CONTEXT`; no hay controllers.
