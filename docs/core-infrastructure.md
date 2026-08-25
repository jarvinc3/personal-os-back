# Core infrastructure — Personal OS Backend

Núcleo transversal de `personal-os-back` (NestJS 11). Los módulos de dominio **users, finance, notifications, ai-agent** ya están implementados; este doc describe el core y el event-driven selectivo.

## Stack

| Capa | Tecnología |
| --- | --- |
| Framework | NestJS 11 |
| ORM | Prisma 7 + PostgreSQL (Supabase) |
| Auth | Supabase Auth (JWT vía JWKS) |
| Colas | BullMQ + Redis (opcional en dev); Bull Board `/admin/queues` (solo development) |
| Eventos | `@nestjs/event-emitter` (in-process, single-instance) |
| Logs | Pino |
| API docs | Swagger `/docs` (off en production) |
| Tiempo real | Socket.IO `/notifications` |

---

## Configuración (`src/config/`)

- Zod env: Redis obligatorio en prod; `OAUTH_STATE_SECRET` obligatorio en prod.
- `REDIS_ENABLED=true` + `REDIS_URL` para BullMQ en development.
- `EXCHANGE_RATE_HOST_API_KEY` — FX histórico (exchangerate.host) en Finance.
- `BASE_CURRENCY` — moneda base de analytics (default típico `DOP`).

## Core (`src/core/`)

Guards JWT/roles/throttle, interceptors (transform, logging, timeout, AI metrics), `AllExceptionsFilter` (500 genérico en prod), catálogo `AppEvents`, colas `notifications` / `ai-processing` / `email-sync` / `gmail-sync`, paginación.

Normalización de campos `error`/`message` en respuestas HTTP: `src/core/exceptions/http-error.util.ts` (`toErrorField`), consumido por `AllExceptionsFilter`. No hay `src/shared/` a nivel raíz.

## Event-driven selectivo + outbox finance

No se usa EDA en todo el CRUD global. En **Finance**:

1. Servicio persiste ledger en `$transaction` (balance + outbox en la misma TX cuando aplica).
2. Filas en `domain_event_outbox` se despachan por `FinanceOutboxDispatcher` (cron 30s + wake post-commit) → `EventEmitter2`.
3. Listeners ligeros crean notificaciones o encolan BullMQ (IA / push).

Finance emite **solo** nombres versionados (sin dual-enqueue legacy):  
`finance.transaction.*`, `finance.budget.threshold_crossed`, `finance.email_sync.completed` / `failed`, `finance.transfer.created` (ver `event.constants.ts`).  
Listeners de notificaciones/IA consumen esos nombres y usan `DomainEventIdempotencyGuard` (`ProcessedDomainEvent`).

Otros módulos pueden seguir emitiendo in-process sin outbox: `user.logged_in` (debounce 1h), `notification.created`, `user.preferences.updated`, `module.*`.

## Finance — invariantes de balance

- Solo `CONFIRMED` muta balances materializados.
- Status email/IA: `PENDING` | `CONFIRMED` | `DECLINED` | `CANCELLED` | `REVERSED`.
- FX: `amount` original + `ledgerAmount` + `amountBaseCurrency`; tasa exacta del día o fallo.
- Confirm de PENDING aplica saldo + `amountSpent`.
- Umbral de presupuesto: una alerta por `(budgetId, type)` en `FinBudgetAlert`.
- Delete/update compensan.
- Reconciliación: `pnpm db:reconcile-balances`.

## Notifications

- Canales: IN_APP, PUSH, EMAIL.
- **EMAIL A2:** Resend vía `EmailSenderPort`; encola/envía solo con `EMAIL_DELIVERY_ENABLED=true` (+ `RESEND_API_KEY`, `MAIL_FROM`).
- Listener `NotificationsEventsListener` reacciona a finance events.

## Auth / Health

- `GET /api/auth/session` emite `user.logged_in` como máximo 1/hora por usuario (cache).
- `GET /api/health` público (liveness).
- `GET /api/health/ready` público (readiness para probes/load balancers). La respuesta sanitizada solo expone `status` y `timestamp` (sin detalle de dependencias).

## Seguridad production

Helmet, trust proxy, body 1mb, Swagger off, CORS WS = `CORS_ORIGIN`, secretos OAuth separados, límites en chat AI.

## Observabilidad

Pino + `requestId`. Logs estructurados en listeners: `event=<name> handled=true`. Fallos de workers Bull vía `@OnWorkerEvent('failed')`.

## Schedule / Bull Board

- `ScheduleModule` montado; cron de `AuthDeletionOutboxProcessor` limpia Supabase Auth pendiente tras borrado de cuenta.
- Bull Board en **`/admin/queues`** (fuera del prefix `/api`), solo cuando `NODE_ENV=development` **y** BullMQ está enabled (`REDIS_URL` + `REDIS_ENABLED=true`).
- Off en `production` y `test` (el path responde 404).
- Basic auth opcional: set `BULL_BOARD_USER` y `BULL_BOARD_PASSWORD` juntos (o ninguno). Útil si la URL de development es pública.
- Colas visibles: `notifications`, `ai-processing`, `email-sync`, `gmail-sync`.
- En non-prod, CORS también permite el origen del propio API (`http://localhost:$PORT`) para acciones del Board (empty/retry).
