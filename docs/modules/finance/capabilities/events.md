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

`FinanceNotificationsListener` conecta esos eventos con el sink neutral: toma
cada evento del outbox, lo pasa por `FinanceNotificationIntents` y entrega cada
intent a `NOTIFICATION_INTENT_SINK` (token de `@personal-os/contracts`).
Notifications no conoce los tipos ni el copy de Finance; la app expone el sink
con `NotificationIntentModule`.

El `data` de un movimiento guarda `transactionId`, `amount`, `currency`,
`merchant`, `categoryName`, `categoryIcon`, `categoryColor`, `accountName`,
`cardName` y `status`, para que la web muestre el ícono de categoría y abra el
detalle. Un movimiento que solo existe como efecto de una acción ya confirmada
en pantalla viaja con `announce: false` y no genera aviso; un movimiento
importado que queda `PENDING` avisa al confirmarse, y los demás avisos conservan
su texto y su preferencia.

Durante la transición, el listener consulta los recibos del listener anterior
(`notifications`, `notifications:<tipo>`) con el `eventId` del evento, o con el
`transferGroupId` en una transferencia, para no duplicar un evento reentregado
tras el despliegue.
