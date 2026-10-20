# Documentación — personal-os-back

Mapa para agentes y reviewers. Estándar: [documentation-standard.md](./documentation-standard.md).

| Área                                           | Para qué                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [architecture/](./architecture/README.md)      | Convención Nest por feature/capa                                   |
| [modules/](./modules/README.md)                | Auth, users, logos, notifications, AI, finance                     |
| [infrastructure/](./infrastructure/README.md)  | Config, health, eventos, colas, Prisma, WS, seguridad              |
| [operations/](./operations/README.md)          | Quick start, env, scripts, tests, CI                               |
| [reference/](./reference/README.md)            | Trazabilidad y guía del changelog                                  |
| [issue-conventions.md](./issue-conventions.md) | Cómo se escriben los issues: estructura, etiquetas, talla y cierre |
| [archive/](./archive/)                         | Registro de revisión, implementaciones y auditorías cerradas       |
| [decisions/](./decisions/README.md)            | ADR                                                                |
| [_templates/](./_templates/module/README.md)   | Plantillas                                                         |
| [glosario.md](./glosario.md)                   | App vs módulo: qué dice la interfaz y qué el código                |

Estado, roadmap y hallazgos: GitHub Issues del repositorio (label `roadmap`).

## Módulos Nest reales

`auth`, `users`, `logos`, `notifications`, `ai-agent`, `finance`. Slugs `agenda` / `projects` / `health` son configuración de `user_modules`, no módulos Nest.
