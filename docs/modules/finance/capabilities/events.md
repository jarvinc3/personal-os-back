# Capacidad: events / outbox

Nombres versionados only. Filas `domain_event_outbox` → dispatcher.

Consumidores: ver [infrastructure/events-and-queues.md](../../../infrastructure/events-and-queues.md).

`finance.email_sync.completed` comparte TX con `FinEmailSyncLog` en el success path. Preferir este evento batch frente a tormentas por email.

`user.data.wiped` (`user.data.wiped`, in-process) es el único evento del vaciado por capas: se emite una vez con `requestedLayers`, `appliedLayers` y `counts`. El wipe de ledger NO reusa el purge por instrumento ni emite `finance.transaction.deleted` por fila.

`finance.balance.drift_detected` lo emite `BalanceIntegrityScheduler` una vez por desviación nueva o cambiada de saldo (invariante I1); ver `integrity.md`.

> [!WARNING]
> **REV-BACK-003** (`NO_IMPLEMENTADO`) — `finance.email_sync.failed` no se emite. [review-register.md](../../../review-register.md#rev-back-003)
