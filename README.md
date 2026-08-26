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
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `true`/`false`/`1`/`0` only. Production default **true**. Nest/pg runtime only |
| `DATABASE_SSL_CA` | Optional PEM CA for Postgres TLS (runtime pool) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Auth JWKS + admin delete |
| `ENCRYPTION_KEY` | Cifrado tokens Gmail (≥32) |
| `OAUTH_STATE_SECRET` | JWT state OAuth (≥32; obligatorio en prod) |
| `REDIS_URL` / `REDIS_ENABLED` | BullMQ (prod exige `REDIS_URL`) |
| `CORS_ORIGIN` | Orígenes HTTP + WebSocket (lista CSV) |
| `GROQ_API_KEY` / … | Proveedores IA |
| `EMAIL_DELIVERY_ENABLED` | `true`/`false` — encola/envía canal EMAIL (default `false`) |
| `RESEND_API_KEY` / `MAIL_FROM` | Obligatorios si `EMAIL_DELIVERY_ENABLED=true` |

**Auth:** JWT vía **JWKS**. No uses `SUPABASE_JWT_SECRET`.

**TLS:** el pool Nest (`PrismaService`) controla `rejectUnauthorized` y CA vía env; **Prisma CLI** (`migrate`, `studio`) usa `DATABASE_URL`/`sslmode` sin esas variables.

**Redis en development:** BullMQ solo si `REDIS_ENABLED=true` y `REDIS_URL`.

**FX:** `EXCHANGE_RATE_HOST_API_KEY` + `BASE_CURRENCY` alimentan el adapter `exchangerate.host` (tasas históricas por fecha; caché en `FinExchangeRate`).

## Scripts

| Comando | Descripción |
| --- | --- |
| `pnpm start:dev` | Desarrollo con hot reload |
| `pnpm build` / `pnpm start:prod` | Compilar / producción |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit tests |
| `pnpm test:e2e` | E2E (health, auth, users, notifications, finance) |
| `pnpm db:migrate` | Migraciones Prisma (dev) |
| `pnpm db:migrate:status` | Estado de migraciones |
| `pnpm db:migrate:deploy` | Aplicar migraciones pendientes |
| `pnpm db:migrate:diff` | Drift schema vs datasource |
| `pnpm db:migrate:resolve:applied` | Marcar migración aplicada sin SQL |
| `pnpm db:validate` / `pnpm db:generate` | Validar schema / generar client |
| `pnpm db:reconcile-balances` | One-shot: recalcular balances y `amountSpent` desde ledger CONFIRMED |
| `pnpm db:studio` | Prisma Studio |

Operaciones de baseline en bases pobladas: no uses `migrate reset` sobre datos reales. Usa `pnpm db:migrate:deploy` para aplicar migraciones pendientes y `pnpm db:migrate:status` / `pnpm db:migrate:diff` para verificar drift.

## Invariantes de finanzas

- Solo transacciones **`CONFIRMED`** mueven saldos.
- Cada transacción debe apuntar a **exactamente uno** de `accountId` o `cardId` (XOR).
- Tarjeta **CREDIT** → mueve `FinCardBalance` por moneda.
- Tarjeta **DEBIT** → requiere `accountId` en la tarjeta y mueve la cuenta subyacente (no el balance de tarjeta).
- Cuenta bancaria → mueve `FinAccount.balance`.
- `PENDING` (manual o EMAIL) no mueve saldo hasta confirm.
- Delete/update de `CONFIRMED` compensa saldo y `FinBudget.amountSpent` en la misma transacción.
- Monedas se normalizan a ISO 4217 de 3 letras (`DOP`, `USD`, …).

## Eventos (selectivo)

Catálogo en `src/core/events/event.constants.ts`. Patrón: EventEmitter post-commit → listeners (notif / IA) → BullMQ para trabajo pesado.

| Evento | Emisor | Listener |
| --- | --- | --- |
| `user.logged_in` | Auth session (debounce 1h) | AI → cola |
| `finance.transaction.*` / `updated` | Finance (outbox) | Notif IN_APP (except `deleted`) + AI |
| `finance.budget.threshold_crossed` | Finance (outbox) | Notif + AI |
| `notification.created` | Notifications | log debug |
| `user.preferences.updated` / `module.*` | Users | AI |

## Background jobs (BullMQ)

- `notifications` → push dispatch
- `gmail-sync` → import bancario email
- `ai-processing` → insights IA
- `email-sync` → envío EMAIL (Resend) cuando `EMAIL_DELIVERY_ENABLED=true`

**Bull Board** (inspección de colas): `http://localhost:3100/admin/queues` cuando `NODE_ENV=development` y Redis/BullMQ están enabled. **Deshabilitado en production.** Auth HTTP Basic opcional vía `BULL_BOARD_USER` / `BULL_BOARD_PASSWORD` (ambos o ninguno).

`ScheduleModule` registra crons (p. ej. `AuthDeletionOutboxProcessor` cada minuto para cleanup de Supabase Auth pendiente).

## Seguridad (production checklist)

- Swagger off
- Bull Board off (`/admin/queues` no montado)
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
  core/            # guards, exceptions, filters, eventos, colas
  health/
  modules/
    auth/
    users/
    finance/
    notifications/
    ai-agent/
  prisma/
prisma/
  migrations/
  scripts/reconcile-balances.ts
docs/
```

## Licencia

UNLICENSED — uso privado del proyecto Personal OS.
