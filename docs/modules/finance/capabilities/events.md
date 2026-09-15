# Capacidad: events / outbox

Nombres versionados only. Filas `domain_event_outbox` → dispatcher.

Consumidores: ver [infrastructure/events-and-queues.md](../../../infrastructure/events-and-queues.md).

`finance.email_sync.completed` comparte TX con `FinEmailSyncLog` en el success path. Preferir este evento batch frente a tormentas por email.

> [!WARNING]
> **REV-BACK-003** (`NO_IMPLEMENTADO`) — `finance.email_sync.failed` no se emite. [review-register.md](../../../review-register.md#rev-back-003)
