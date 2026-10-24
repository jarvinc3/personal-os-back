# Capacidad: events / outbox

Nombres versionados only. Filas `domain_event_outbox` → dispatcher.

Consumidores: ver [infrastructure/events-and-queues.md](../../../infrastructure/events-and-queues.md).

`finance.email_sync.completed` comparte TX con `FinEmailSyncLog` en el success path. Preferir este evento batch frente a tormentas por email.

`user.data.wiped` (`user.data.wiped`, in-process) es el único evento del vaciado: se emite una vez con `requestedBranches`, `appliedBranches` y `counts`. El vaciado de movimientos NO reusa el purge por instrumento ni emite `finance.transaction.deleted` por fila. Un movimiento que solo es efecto de una acción ya confirmada viaja con `announce: false` y no genera aviso.

`finance.balance.drift_detected` lo emite `BalanceIntegrityScheduler` una vez por desviación nueva o cambiada de saldo (invariante I1); ver `integrity.md`.

`finance.email_sync.failed` se encola en el outbox al fallar un sync.
