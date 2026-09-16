# Documentación — personal-os-back

Mapa para agentes y reviewers. Estándar: [documentation-standard.md](./documentation-standard.md). Hallazgos: [review-register.md](./review-register.md).

| Área | Para qué |
| --- | --- |
| [architecture/](./architecture/README.md) | Convención Nest por feature/capa |
| [modules/](./modules/README.md) | Auth, users, notifications, AI, finance |
| [infrastructure/](./infrastructure/README.md) | Config, health, eventos, colas, Prisma, WS, seguridad |
| [operations/](./operations/README.md) | Quick start, env, scripts, tests, CI |
| [reference/](./reference/README.md) | Trazabilidad |
| [decisions/](./decisions/README.md) | ADR |
| [_templates/](./_templates/module/README.md) | Plantillas |

## Módulos Nest reales

`auth`, `users`, `notifications`, `ai-agent`, `finance`. Slugs `agenda` / `projects` / `health` / `subscriptions` son configuración de `user_modules`, no módulos Nest.
