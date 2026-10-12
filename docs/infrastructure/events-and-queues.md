# Eventos y colas

Catálogo: [`packages/core/src/events/event.constants.ts`](../../packages/core/src/events/event.constants.ts). Colas: [`packages/core/src/queues/queue.constants.ts`](../../packages/core/src/queues/queue.constants.ts).

## AppEvents (VERIFICADO)

| Constante                                        | Valor                                                                                  | Emisor típico              | Consumidores                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------- |
| `USER_LOGGED_IN`                                 | `user.logged_in`                                                                       | Auth session (debounce 1h) | AI → cola                              |
| `FINANCE_TRANSACTION_*`                          | `finance.transaction.{imported,confirmed,updated,declined,cancelled,reversed,deleted}` | Finance outbox             | Notif (deleted: claim silencioso) + AI |
| `FINANCE_TRANSFER_CREATED`                       | `finance.transfer.created`                                                             | Finance outbox             | —                                      |
| `FINANCE_BUDGET_THRESHOLD_CROSSED`               | `finance.budget.threshold_crossed`                                                     | Finance outbox             | Notif + AI                             |
| `FINANCE_EMAIL_SYNC_COMPLETED`                   | `finance.email_sync.completed`                                                         | Finance outbox             | AI batch                               |
| `FINANCE_EMAIL_SYNC_FAILED`                      | `finance.email_sync.failed`                                                            | —                          | —                                      |
| `NOTIFICATION_CREATED`                           | `notification.created`                                                                 | Notifications              | log / pipeline                         |
| `USER_PREFERENCES_UPDATED`                       | `user.preferences.updated`                                                             | Users                      | AI                                     |
| `MODULE_ENABLED` / `DISABLED` / `CONFIG_UPDATED` | `module.*`                                                                             | Users                      | AI                                     |

> [!WARNING]
> **REV-BACK-003** (`NO_IMPLEMENTADO`) — `finance.email_sync.failed` está en el catálogo y se documentaba como evento de ops; no hay enqueue/emit en `src/`. [review-register.md](../review-register.md#rev-back-003)

Patrón Finance: persistir outbox en la misma TX → `FinanceOutboxDispatcher` (cron `EVERY_30_SECONDS` + wake) → `EventEmitter2` → listeners con `DomainEventIdempotencyGuard` (`ProcessedDomainEvent`).

No es event sourcing: el outbox es durabilidad de entrega.

## Colas BullMQ

| Nombre          | Uso                                                   |
| --------------- | ----------------------------------------------------- |
| `notifications` | Dispatch push                                         |
| `gmail-sync`    | Import bancario email                                 |
| `ai-processing` | Insights IA                                           |
| `email-sync`    | Envío EMAIL (Resend) si `EMAIL_DELIVERY_ENABLED=true` |

**Bull Board:** `http://localhost:$PORT/admin/queues` cuando `NODE_ENV=development` **y** BullMQ enabled. Fuera del prefix `/api`. Off en production/test (404). Basic auth opcional: `BULL_BOARD_USER` + `BULL_BOARD_PASSWORD`. En non-prod CORS permite el origen del propio API para retry/empty.

## Crons (VERIFICADO)

| Cron               | Handler                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| `EVERY_30_SECONDS` | `FinanceOutboxDispatcher`                                                          |
| `EVERY_MINUTE`     | `AuthDeletionOutboxProcessor`                                                      |
| `EVERY_5_MINUTES`  | `AiActionsReaperService` (RUNNING > 15 min)                                        |
| `EVERY_6_HOURS`    | `GmailAutoSyncScheduler` (opt-in `emailSync.automatic`; LLM solo con mails nuevos) |

> [!WARNING]
> **REV-BACK-004** (`CONTRADICE_CODIGO`) — comentario en `app.module.ts` «no @Cron handlers yet» contradice los tres crons anteriores. [review-register.md](../review-register.md#rev-back-004)
