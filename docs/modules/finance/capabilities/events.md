# Capacidad: eventos y outbox

Finance es dueño de los nombres, payloads y versiones semánticas de sus
eventos. Los contratos están en
[`packages/finance/src/contracts/finance-events.ts`](../../../../packages/finance/src/contracts/finance-events.ts).
Core aporta el envelope durable y el dispatcher. El catálogo `AppEvents` de Core
solo contiene eventos de plataforma; los consumidores Finance importan los
nombres desde `@personal-os/finance`.

Filas `domain_event_outbox` → dispatcher.

Consumidores: ver [infrastructure/events-and-queues.md](../../../infrastructure/events-and-queues.md).

`user.data.wiped` (`user.data.wiped`, in-process) es el único evento del vaciado: se emite una vez con `requestedBranches`, `appliedBranches` y `counts`. El vaciado de movimientos NO reusa el purge por instrumento ni emite `finance.transaction.deleted` por fila. Un movimiento que solo es efecto de una acción ya confirmada viaja con `announce: false` y no genera aviso.

`finance.balance.drift_detected` lo emite `BalanceIntegrityScheduler` una vez por desviación nueva o cambiada de saldo (invariante I1); ver `integrity.md`.

Finance no emite eventos de sincronización de correo; esa fuente pertenece a Intelligence.
