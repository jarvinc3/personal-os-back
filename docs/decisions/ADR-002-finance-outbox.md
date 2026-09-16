# ADR-002: Outbox finance, no event sourcing

- Estado: `accepted`

## Contexto

Notificaciones e IA deben reaccionar a mutaciones de ledger sin perder eventos si el proceso cae tras el commit, y sin acoplar Finance a esos módulos.

## Decisión

Escribir `DomainEventOutbox` en la misma `$transaction` que el ledger. Dispatcher cron 30s + wake post-commit emite `EventEmitter2`. Idempotencia por consumidor en `ProcessedDomainEvent`. No dual-enqueue de nombres legacy.

## Alternativas

EventEmitter síncrono solo in-process; cola por cada write; event sourcing completo.

## Consecuencias

Listeners ligeros. EMAIL source usa batch `finance.email_sync.completed` para no inundar. `finance.transaction.deleted` se reclama en notificaciones sin toast.
