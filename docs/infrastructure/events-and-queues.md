# Eventos y colas

Catálogo de plataforma: [`packages/core/src/events/event.constants.ts`](../../packages/core/src/events/event.constants.ts). Catálogo Finance: [`packages/finance/src/contracts/finance-events.ts`](../../packages/finance/src/contracts/finance-events.ts). Colas: [`packages/core/src/queues/queue.constants.ts`](../../packages/core/src/queues/queue.constants.ts).

## AppEvents de plataforma (VERIFICADO)

| Constante                                        | Valor                      | Emisor típico              | Consumidores   |
| ------------------------------------------------ | -------------------------- | -------------------------- | -------------- |
| `USER_LOGGED_IN`                                 | `user.logged_in`           | Auth session (debounce 1h) | AI → cola      |
| `NOTIFICATION_CREATED`                           | `notification.created`     | Notifications              | log / pipeline |
| `USER_PREFERENCES_UPDATED`                       | `user.preferences.updated` | Users                      | AI             |
| `MODULE_ENABLED` / `DISABLED` / `CONFIG_UPDATED` | `module.*`                 | Users                      | AI             |

Los nombres y payloads Finance viven en `FinanceEvents` de `@personal-os/finance`; consulte [eventos Finance](../modules/finance/capabilities/events.md).

Patrón de outbox: persistir el evento en la misma TX que el cambio → `OutboxRelay` de Core (cron `EVERY_30_SECONDS` + wake) → `EventEmitter2` → listeners con `DomainEventIdempotencyGuard` (`ProcessedDomainEvent`). La infraestructura es genérica: vive en `packages/core/src/events/outbox/` y cada dominio aporta solo nombres, payloads y versiones. Los productores dependen de los ports neutrales de `@personal-os/contracts`: `DomainEventPublisher` (`enqueue`), `DomainEventRelay` (`wake`) y `DomainEventOutboxReader` (`hasEvent`).

AI-7 escribe `ai.signal.routed` en el mismo commit que `AiSignal` y su evidencia. El listener `AiSignalOutboxBridge` entrega a `ai-signal-routing` con un `jobId` estable; si Redis/cola no está configurado o falla el enqueue, propaga el error para que el relay reintente el outbox.

No es event sourcing: el outbox es durabilidad de entrega.

## Recuperación y atomicidad de entrega

- Cada claim guarda `claimedAt` e incrementa `attempts`. Un lease de cinco
  minutos vencido regresa a `PENDING`; si agotó ocho intentos queda en `DEAD`.
  Filas antiguas en `PROCESSING` sin `claimedAt` también son recuperables.
- El cierre exige el mismo `id`, estado, intento y lease. Un worker que perdió
  el lease no puede sobrescribir el resultado de un intento nuevo.
- `DomainEventIdempotencyGuard.runOnce` confirma el recibo y los efectos
  PostgreSQL en una transacción. `tryClaim` queda limitado a consumidores sin
  efecto o a marcar un encolado externo ya confirmado; no se llama antes del
  trabajo. Los errores de almacenamiento se propagan.
- El listener de Finance traduce sus eventos del outbox a intents y los entrega
  al sink (`NOTIFICATION_INTENT_SINK`) con `suppressErrors: false`: una excepción
  llega al relay y activa backoff. `NotificationIntentModule` expone el sink en la
  app sin que Finance importe Notifications.
- Notifications guarda IN_APP en la misma transacción del recibo. Publica el
  aviso WebSocket después del commit; si falla el aviso, la notificación sigue
  disponible por listado/unread. El socket no es un transporte durable.
- El pipeline de intents escribe una fila por canal aceptado y el recibo del
  canal (`processed_domain_events`, consumidor `notifications:intent:<canal>`)
  con el puntero a la fila en una transacción; la policy filtra preferencia y
  horas de silencio por canal antes de persistir. La entrega ocurre después del
  commit, PUSH/EMAIL conservan los reintentos de la cola `notifications` y su
  `jobId` es el id de la fila. El recibo `notifications:intent-delivered` marca
  el envío: si falta, el reintento del intent reentrega la fila persistida sin
  crear otra.
- IA encola con job ID estable por usuario/consumidor/evento y guarda el recibo
  después de Redis. Esos jobs no se eliminan automáticamente: cubren una caída
  entre encolado y recibo. Solo se limpian tras verificar su recibo confirmado;
  no se promete entrega exactamente una vez a servicios externos.
- Si la cola de IA no está disponible para un evento durable, la entrega falla
  y se reintenta hasta el límite; no se registra como procesado silenciosamente.

Las marcas históricas creadas antes de esta corrección no se eliminan ni se
reproducen automáticamente. El puente genérico outbox → BullMQ para Signals
se construye en AI-7; hoy el relay publica mediante `EventEmitter2`.

Despliegue: drenar o detener los workers de la versión anterior, aplicar la
migración aditiva y arrancar la nueva versión. No mezclar relays pre-lease con
relays nuevos: el código anterior cierra filas sin verificar el intento. Para
rollback de código, detener primero los workers nuevos; conservar columnas y
recibos, y revisar las filas `PROCESSING` porque el código viejo no las recupera.
El merge y la ejecución de este despliegue corresponden al owner.

Evidencia: `packages/core/src/events/outbox/outbox-relay.spec.ts`,
`domain-events.module.spec.ts`,
`domain-event-idempotency.guard.spec.ts` y
`test/integration/outbox.integration-spec.ts` (PostgreSQL real y procesos terminados).

## Colas BullMQ

| Nombre                   | Uso                                                   |
| ------------------------ | ----------------------------------------------------- |
| `notifications`          | Dispatch push                                         |
| `gmail-sync`             | Import bancario email                                 |
| `ai-processing`          | Insights IA                                           |
| `email-sync`             | Envío EMAIL (Resend) si `EMAIL_DELIVERY_ENABLED=true` |
| `ai-signal-routing`      | Entrega de señales a sus consumidores                 |
| `ai-email-sample-import` | Corrida asíncrona de `sample-import` (#355)           |

**Bull Board:** `http://localhost:$PORT/admin/queues` cuando `NODE_ENV=development` **y** BullMQ enabled. Fuera del prefix `/api`. Off en production/test (404). Basic auth opcional: `BULL_BOARD_USER` + `BULL_BOARD_PASSWORD`. En non-prod CORS permite el origen del propio API para retry/empty.

## Crons (VERIFICADO)

Los 14 `@Cron` registrados por los módulos, de menor a mayor cadencia:

| Cron               | Handler                                    | Qué hace                                                         |
| ------------------ | ------------------------------------------ | ---------------------------------------------------------------- |
| `EVERY_30_SECONDS` | `OutboxRelay` (Core)                       | Reclama y despacha los eventos del outbox                        |
| `EVERY_MINUTE`     | `AuthDeletionOutboxProcessor` (Users)      | Procesa los borrados de Auth pendientes                          |
| `EVERY_5_MINUTES`  | `AiActionsReaperService` (Intelligence)    | Marca como fallidas las acciones `RUNNING` de más de 15 min      |
| `EVERY_HOUR`       | `WeeklySummaryScheduler` (Finance)         | Envía el resumen semanal en el día y la hora locales del usuario |
| `EVERY_DAY_AT_1AM` | `CardStatementsScheduler` (Finance)        | Sincroniza los estados de cuenta de las tarjetas de crédito      |
| `EVERY_DAY_AT_2AM` | `BudgetRecurringScheduler` (Finance)       | Crea el período siguiente de cada presupuesto recurrente         |
| `EVERY_DAY_AT_2AM` | `DeletionJournalRetentionScheduler`        | Purga el diario de borrados fuera de su retención de 30 días     |
| `EVERY_DAY_AT_2AM` | `AiEmailRetentionScheduler` (Intelligence) | Purga el contenido crudo de correos fuera de retención           |
| `EVERY_DAY_AT_3AM` | `IdempotencyKeyRetentionScheduler` (Core)  | Purga por tandas las claves de idempotencia vencidas             |
| `EVERY_DAY_AT_3AM` | `RecurringDetectionScheduler` (Finance)    | Detecta patrones recurrentes y emite sus alertas                 |
| `EVERY_DAY_AT_3AM` | `AiInferenceRetentionScheduler`            | Purga las inferencias de IA vencidas                             |
| `EVERY_DAY_AT_4AM` | `BalanceIntegrityScheduler` (Finance)      | Barrido nocturno de desvíos de saldo, usuario por usuario        |
| `EVERY_DAY_AT_6AM` | `SubscriptionRemindersScheduler` (Finance) | Recordatorios de renovación y cargos de suscripción perdidos     |
| `EVERY_DAY_AT_7AM` | `CardPaymentRemindersScheduler` (Finance)  | Aviso previo al pago de un estado de cuenta cerrado              |

Gmail no usa `@Cron`: `GmailSyncService` corre con `setInterval` cada `AI_EMAIL_SYNC_INTERVAL_MINUTES`, más un watchdog de sincronizaciones estancadas. No arranca en `NODE_ENV=test` ni sin OAuth configurado.
