# Decisiones (ADR)

Plantilla: [_templates/module/decisions/ADR-template.md](../_templates/module/decisions/ADR-template.md).

| ADR                                                      | Título                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| [ADR-001](./ADR-001-capability-modules.md)               | Módulos Nest por feature/capability, no por capa global        |
| [ADR-002](./ADR-002-finance-outbox.md)                   | Outbox finance + EventEmitter selectivo (no event sourcing)    |
| [ADR-003](./ADR-003-email-transaction-dedupe.md)         | Deduplicación de transacciones importadas por correo           |
| [ADR-004](./ADR-004-configurable-gmail-sync-schedule.md) | Frecuencia de sincronización de Gmail configurable por usuario |
| [ADR-005](./ADR-005-pnpm-workspaces-monorepo.md)         | Monorepo con pnpm workspaces y paquetes compilados             |
| [ADR-006](./ADR-006-cursor-pagination.md)                | Paginación por cursor en los endpoints de lista                |
| [ADR-007](./ADR-007-sin-prefijo-de-version.md)           | Sin prefijo de versión en la API (`/v1`)                       |
