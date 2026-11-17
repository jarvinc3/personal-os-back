# Capacidad: eventos y outbox

Finance es dueño de los nombres, payloads y versiones semánticas de sus
eventos. Los contratos están en
[`packages/finance/src/contracts/finance-events.ts`](../../../../packages/finance/src/contracts/finance-events.ts).
Core aporta el outbox durable y el relay compartido; el catálogo `AppEvents` de
Core solo contiene eventos de plataforma y los consumidores Finance importan los
nombres desde `@personal-os/finance`.

Los productores de Finance dependen de los ports de `@personal-os/contracts`:
`DomainEventPublisher` para escribir el evento en la transacción en curso,
`DomainEventOutboxReader` para no repetir un aviso ya emitido y
`DomainEventRelay` para despertar la entrega tras el commit. Ningún caso de uso
de Finance importa la infraestructura del relay.

Filas `domain_event_outbox` → `OutboxRelay` de Core.

Consumidores: ver [infrastructure/events-and-queues.md](../../../infrastructure/events-and-queues.md).

`user.data.wiped` (`user.data.wiped`, in-process) es el único evento del vaciado: se emite una vez con `requestedBranches`, `appliedBranches` y `counts`. El vaciado de movimientos NO reusa el purge por instrumento ni emite `finance.transaction.deleted` por fila. Un movimiento que solo es efecto de una acción ya confirmada viaja con `announce: false` y no genera aviso.

`finance.balance.drift_detected` lo emite `BalanceIntegrityScheduler` una vez por desviación nueva o cambiada de saldo (invariante I1); ver `integrity.md`.

Finance no emite eventos de sincronización de correo; esa fuente pertenece a Intelligence.
