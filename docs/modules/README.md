# Módulos (backend)

Cada fila es un módulo Nest en `packages/*/src/`.

| Módulo        | Código                        | Doc                                         | Estilo                     |
| ------------- | ----------------------------- | ------------------------------------------- | -------------------------- |
| Auth          | `packages/auth/src/`          | [auth/](./auth/README.md)                   | Simple                     |
| Users         | `packages/users/src/`         | [users/](./users/README.md)                 | Simple                     |
| Notifications | `packages/notifications/src/` | [notifications/](./notifications/README.md) | Simple                     |
| Intelligence  | `packages/intelligence/src/`  | [intelligence/](./intelligence/README.md)   | Complejo (capabilities)    |
| Finance       | `packages/finance/src/`       | [finance/](./finance/README.md)             | Complejo + submódulos Nest |
| Logos         | `packages/logos/src/`         | [logos/](./logos/README.md)                 | Simple + puertos           |

Estándar de carpetas: [architecture/modules.md](../architecture/modules.md).

## No son módulos Nest

`agenda`, `projects`, `health` — slugs en `MODULE_SLUGS` / `user_modules`. Tools de contexto existen en `MODULE_CONTEXT`; no hay controllers. Suscripciones no es un módulo: vive dentro de Finanzas (`packages/finance/src/subscriptions/`), con sus ajustes en el bloque `subscriptions` de la config de finanzas.
