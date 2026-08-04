# Core infrastructure — Personal OS Backend

Núcleo transversal de `personal-os-back` (NestJS 11). Los módulos de dominio **users, finance, notifications, ai-agent** ya están implementados; este doc describe el core y el event-driven selectivo.

## Stack

| Capa | Tecnología |
| --- | --- |
| Framework | NestJS 11 |
| ORM | Prisma 7 + PostgreSQL (Supabase) |
| Auth | Supabase Auth (JWT vía JWKS) |
| Colas | BullMQ + Redis (opcional en dev) |
| Eventos | `@nestjs/event-emitter` (in-process, single-instance) |
| Logs | Pino |
| API docs | Swagger `/docs` (off en production) |
| Tiempo real | Socket.IO `/notifications` |

---

## Configuración (`src/config/`)

- Zod env: Redis obligatorio en prod; `OAUTH_STATE_SECRET` obligatorio en prod.
- `REDIS_ENABLED=true` + `REDIS_URL` para BullMQ en development.
- `EXCHANGE_RATE_HOST_API_KEY` reservada / no cableada aún.

## Core (`src/core/`)

Guards JWT/roles/throttle, interceptors (transform, logging, timeout, AI metrics), `AllExceptionsFilter` (500 genérico en prod), catálogo `AppEvents`, colas `notifications` / `ai-processing` / `email-sync` / `gmail-sync`, paginación.

## Event-driven selectivo

No se usa EDA en todo el CRUD. Flujo:

1. Servicio persiste en `$transaction`.
2. Emite evento post-commit (`EventEmitter2`).
3. Listeners ligeros crean notificaciones o encolan BullMQ (IA / push).

Sin transactional outbox (despliegue single-instance).

Eventos activos: `user.logged_in` (debounce cache 1h), `transaction.*`, `budget.threshold_reached`, `notification.created`, `user.preferences.updated`, `module.*`.

## Finance — invariantes de balance

- Solo `CONFIRMED` muta balances materializados.
- Confirm de PENDING (EMAIL/manual) aplica saldo + `amountSpent`.
- Delete/update compensan.
- Reconciliación: `pnpm db:reconcile-balances`.

## Notifications

- Canales: IN_APP, PUSH, EMAIL.
- **EMAIL A1:** stub — no envía correo; en production no se encola dispatch EMAIL.
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
- `@bull-board/*` en devDependencies **sin** wiring (reservado).
