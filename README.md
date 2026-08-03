# Personal OS — Backend

API NestJS para **Personal OS**: auth con Supabase, usuarios, **finanzas**, notificaciones, agente IA y núcleo transversal (guards, eventos, colas, WebSocket, health).

Documentación del core: [docs/core-infrastructure.md](./docs/core-infrastructure.md).

## Requisitos

- Node.js 20+
- pnpm
- PostgreSQL (Supabase)
- Proyecto Supabase con Auth habilitado
- Redis (opcional en local; obligatorio en production)
- Al menos una API key: `GROQ_API_KEY`, `CEREBRAS_API_KEY` o `OPENROUTER_API_KEY`

## Inicio rápido

```bash
cd personal-os-back
cp .env.example .env
# Editar .env con tus credenciales

pnpm install
pnpm db:generate
pnpm start:dev
```

- API: `http://localhost:3100/api` (según `PORT` y `API_PREFIX`)
- Swagger: `http://localhost:3100/docs` (**deshabilitado en production**)

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Postgres (Supabase) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Auth JWKS + admin delete |
| `ENCRYPTION_KEY` | Cifrado tokens Gmail (≥32) |
| `OAUTH_STATE_SECRET` | JWT state OAuth (≥32; obligatorio en prod) |
| `REDIS_URL` / `REDIS_ENABLED` | BullMQ (prod exige `REDIS_URL`) |
| `CORS_ORIGIN` | Orígenes HTTP + WebSocket (lista CSV) |
| `GROQ_API_KEY` / … | Proveedores IA |

**Auth:** JWT vía **JWKS**. No uses `SUPABASE_JWT_SECRET`.

**Redis en development:** BullMQ solo si `REDIS_ENABLED=true` y `REDIS_URL`.

**FX:** `EXCHANGE_RATE_HOST_API_KEY` está reservada y **no se usa** aún en código.

## Scripts

| Comando | Descripción |
| --- | --- |
| `pnpm start:dev` | Desarrollo con hot reload |
| `pnpm build` / `pnpm start:prod` | Compilar / producción |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit tests |
| `pnpm test:e2e` | E2E (health, auth, users, notifications, finance) |
| `pnpm db:migrate` | Migraciones Prisma |
| `pnpm db:reconcile-balances` | One-shot: recalcular balances y `amountSpent` desde ledger CONFIRMED |
| `pnpm db:studio` | Prisma Studio |

## Invariantes de finanzas

- Solo transacciones **`CONFIRMED`** mueven `FinAccount.balance` / `FinCardBalance`.
- `PENDING` (manual o EMAIL) no mueve saldo hasta confirm.
- Delete/update de `CONFIRMED` compensa saldo y `FinBudget.amountSpent` en la misma transacción.
- Tras datos legacy, ejecutar `pnpm db:reconcile-balances` en staging.

## Eventos (selectivo)

Catálogo en `src/core/events/event.constants.ts`. Patrón: EventEmitter post-commit → listeners (notif / IA) → BullMQ para trabajo pesado.

| Evento | Emisor | Listener |
| --- | --- | --- |
| `user.logged_in` | Auth session (debounce 1h) | AI → cola |
| `transaction.created` / `updated` | Finance | Notif IN_APP + AI |
| `budget.threshold_reached` | Finance | Notif + AI |
| `notification.created` | Notifications | log debug |
| `user.preferences.updated` / `module.*` | Users | AI |

## Background jobs (BullMQ)

- `notifications` → push dispatch
- `gmail-sync` → import bancario email
- `ai-processing` → insights IA
- `email-sync` → **stub A1** (EMAIL no es production-ready; no envía correo)

`@bull-board/*` está en devDependencies pero **no está montado** (reservado).

`ScheduleModule` está registrado sin crons (reservado).

## Seguridad (production checklist)

- Swagger off
- Helmet + `trust proxy`
- 500 genéricos al cliente
- WS CORS = `CORS_ORIGIN`
- `/health` y `/health/ready` públicos; readiness sanitiza el contrato (sin detalle de dependencias)
- Separar `OAUTH_STATE_SECRET` de `ENCRYPTION_KEY`

## Endpoints principales

| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| GET | `/api/health` | No | Liveness |
| GET | `/api/health/ready` | No | Readiness (DB + JWKS + Redis); payload sanitizado |
| GET | `/api/auth/session` | Sí | Sesión (emite login debounced) |
| GET/PATCH/DELETE | `/api/users/me` | Sí | Perfil |
| * | `/api/finance/*` | Sí | Cuentas, txs, presupuestos, Gmail sync, analytics |
| * | `/api/notifications/*` | Sí | IN_APP / push |
| * | `/api/ai/*` | Sí | Chat, sesiones, acciones |

Respuestas: envelope `{ data, meta }`.

## WebSocket

- Namespace `/notifications`
- Auth Bearer o `auth.token`
- Eventos: `notification.new`, `ai.response`, `ping`
- CORS alineado con `CORS_ORIGIN`

## CI

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml): audit (continue-on-error) → lint → prisma validate → build → unit → e2e.

## Estructura

```tree
src/
  config/
  core/            # guards, eventos, colas
  health/
  modules/
    auth/
    users/
    finance/
    notifications/
    ai-agent/
  prisma/
  shared/processors/
prisma/
  migrations/
  scripts/reconcile-balances.ts
docs/
```

## Licencia

UNLICENSED — uso privado del proyecto Personal OS.
