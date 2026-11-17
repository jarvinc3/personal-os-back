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

## Avisos e intents

Finance decide qué hecho merece un aviso y qué dice. El copy, las claves de
preferencia (`FINANCE_NOTIFICATION_KEYS`), el formato de montos y la identidad de
deduplicación viven en
[`packages/finance/src/notifications/`](../../../../packages/finance/src/notifications/).
`FinanceNotificationIntents` implementa `FinanceNotificationAdapter` y traduce
cada evento a `NotificationIntent` neutral:

- `sourceDomain` es `finance`; los canales solicitados son `IN_APP`, como hoy.
- `preferenceKey` es la clave del módulo; `data` conserva `moduleSlug`,
  `notificationKey` y los ids que consume la web.
- `deduplicationKey` es `finance:<tipo>:<identidad>`, con el `eventId` del evento
  o el `transferGroupId` en una transferencia, para que las dos patas generen un
  solo aviso.
- No hay intent para borrados, rechazos, cancelaciones, reversos, filas
  `finance.transfer.created` ni movimientos con `announce: false`.

Notifications sigue interpretando los eventos de Finance y persistiendo el aviso
IN_APP hasta NOTIF-2 (#323); desde FIN-4 importa el copy y las claves de
`@personal-os/finance` en vez de mantener una copia propia.
