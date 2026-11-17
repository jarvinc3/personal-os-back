# ADR-002: Outbox durable, no event sourcing

- Estado: `accepted`

## Contexto

Notificaciones e IA deben reaccionar a mutaciones de ledger sin perder eventos si el proceso cae tras el commit, y sin acoplar Finance a esos módulos.

## Decisión

Escribir `DomainEventOutbox` en la misma `$transaction` que el ledger. El relay de Core (`OutboxRelay`, cron 30s + wake post-commit) emite `EventEmitter2`. Idempotencia por consumidor en `ProcessedDomainEvent`. No dual-enqueue de nombres legacy.

PLATFORM-EVENTS-1 (#319) movió el relay genérico y la escritura del outbox a Core detrás de los ports `DomainEventPublisher`, `DomainEventOutboxReader` y `DomainEventRelay` de `@personal-os/contracts`; cada dominio conserva los nombres, payloads y versiones de sus eventos. La decisión de fondo no cambia: outbox durable con leases, fencing y reintentos, sin event sourcing.

## Alternativas

EventEmitter síncrono solo in-process; cola por cada write; event sourcing completo.

## Consecuencias

Listeners ligeros. EMAIL source usa batch `finance.email_sync.completed` para no inundar. `finance.transaction.deleted` se reclama en notificaciones sin toast.
