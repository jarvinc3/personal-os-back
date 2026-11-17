# PLATFORM-EVENTS-1 — Relay de outbox genérico

**Issue:** [back #319](https://github.com/jarvinc3/personal-os-back/issues/319)

## Objetivo

Promover el relay genérico que hoy vive en Finance a infraestructura compartida, manteniendo un port de publicación de eventos.

## Alcance

Ubicar `OutboxRelay` en Core detrás de `DomainEventPublisher`; migrar los casos de uso de Finance que hoy inyectan el dispatcher concreto. Conservar leases recuperables, fencing, atomicidad y pruebas de caída con PostgreSQL. El outbox de borrado de Users se evalúa por separado y no se unifica por simetría.

## Resultado

- Core aloja `OutboxRelay`, `PrismaDomainEventOutbox` y `DomainEventsModule` en `packages/core/src/events/outbox/`; no se copia el relay en ningún dominio.
- `@personal-os/contracts` define los ports neutrales y sus tokens: `DomainEventPublisher` (`enqueue`), `DomainEventOutboxReader` (`hasEvent`) y `DomainEventRelay` (`wake`).
- Los casos de uso, servicios y schedulers de Finance inyectan esos tokens; los módulos de Finance y Notifications importan `DomainEventsModule` de Core.
- Se conservan el esquema del outbox, los leases, el fencing por `attempts`, los reintentos con backoff y la recuperación tras caída. Los specs del relay y la prueba de integración con PostgreSQL viajan con la infraestructura.

## Gate

Otro dominio puede publicar de forma confiable sin copiar infraestructura de Finance; las garantías de recuperación e idempotencia siguen cubiertas por pruebas.

[Índice de fases de plataforma](README.md).
