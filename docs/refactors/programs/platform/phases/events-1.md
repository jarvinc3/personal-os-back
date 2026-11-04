# PLATFORM-EVENTS-1 — Relay de outbox genérico

**Issue:** [back #319](https://github.com/jarvinc3/personal-os-back/issues/319)

## Objetivo

Promover el relay genérico que hoy vive en Finance a infraestructura compartida, manteniendo un port de publicación de eventos.

## Alcance

Ubicar `OutboxRelay` en Core detrás de `DomainEventPublisher`; migrar los casos de uso de Finance que hoy inyectan el dispatcher concreto. Conservar leases recuperables, fencing, atomicidad y pruebas de caída con PostgreSQL. El outbox de borrado de Users se evalúa por separado y no se unifica por simetría.

## Gate

Otro dominio puede publicar de forma confiable sin copiar infraestructura de Finance; las garantías de recuperación e idempotencia siguen cubiertas por pruebas.

[Índice de fases de plataforma](README.md).
