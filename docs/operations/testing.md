# Testing

| Tipo | Cómo            | Alcance                                                  |
| ---- | --------------- | -------------------------------------------------------- |
| Unit | `pnpm test`     | Specs junto al unit (`*.spec.ts`)                        |
| E2E  | `pnpm test:e2e` | `test/*.e2e-spec.ts` — Prisma mock / auth test providers |

## Pruebas manuales AI-0 a AI-11

Los 104 casos manuales de Finanzas e Inteligencia y el flujo para guardar rondas están en [docs/testing/README.md](../testing/README.md). Esta herramienta no ejecuta pruebas ni sustituye la CI.

## Integración con PostgreSQL real

`pnpm test:integration` exige `TEST_DATABASE_URL` explícita hacia PostgreSQL
local (`localhost`, `127.0.0.1` o `::1`), con las migraciones aplicadas. No usa
la URL implícita de `.env`. CI la proporciona sobre su servicio PostgreSQL.
Supabase usa PostgreSQL; esta suite verifica atomicidad SQL y recuperación,
no reemplaza las pruebas de Auth/Storage/RLS específicas de Supabase.

La suite crea un schema aleatorio `outbox_test_*`, copia tablas/índices y enums
necesarios y lo elimina al terminar. Nunca modifica filas de `public`. Necesita
paquetes compilados porque mata procesos hijos que ejecutan las clases reales
del relay/guard. El comando compila los paquetes antes de correr Jest.

Cubre rollback de recibo+efecto, entregas concurrentes, leases activos/vencidos,
fencing de workers viejos y caídas antes/después del commit. Jest se ejecuta con
`--experimental-vm-modules` por los imports dinámicos del motor Prisma 7.

Auth e2e: `test/helpers/auth-test.providers.ts` (HS256 overrides). **Nunca** `NODE_ENV=test` sobre el path de auth de production.

Finance HTTP smoke: `pnpm smoke:finance` recorre con `GET` los endpoints clave de finanzas contra `SMOKE_BASE_URL` (default `http://localhost:3100`) con un `SMOKE_ACCESS_TOKEN`. Sustituye la corrida histórica `prisma/scripts/smoke-finance-http.ts` (REV-BACK-005/011). Sustituto automatizado sin API levantada: `pnpm test:e2e --testPathPatterns=finance`.

## Requisito por cambio

Los E2E son obligatorios en todo cambio, no solo al tocar pruebas. Antes de dar un cambio por terminado:

1. `pnpm lint`
2. `pnpm test`
3. `pnpm test:e2e`

Un cambio de contrato HTTP o de datos que no actualice su E2E deja el CI en rojo.
