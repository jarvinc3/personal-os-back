# Finance — overview

## Propósito

Finanzas personales: consolidar cuentas/tarjetas/efectivo; registrar y categorizar movimientos; presupuestos y metas; préstamos y cobros; importar actividad bancaria desde emails Gmail. Datos por usuario; RLS en Supabase/Postgres.

## Consumidores

- REST `/api/finance/*` (controllers por capability)
- Web (`personal-os-web`) y móvil (otro repo)
- AI capabilities `moduleSlug=finance` se publican desde Finance; AI-9 expone un resumen mensual solo lectura mediante `FinanceAiCapabilities`.

`FinanceModule` exporta `FinanceFacade` y `FinanceAiCapabilities`. El runtime AI usa el provider contractual de Finance y no importa la facade. Barrel: `FinanceModule`, `FinanceFacade`, `FinanceAiCapabilities`, `FinanceEventsModule`, `DomainEventIdempotencyGuard`. Fuera de finance no importar `ledger/`, `catalog/`, etc.

## Arquitectura

Composition root puro. Capabilities: `catalog`, `ledger`, `planning`, `analytics`, `balance-sheet`, `ingestion`, `fx`, `events`, `shared`.

Use-cases para writes con reglas distintas (ledger, Gmail process, FX amounts). Fat services para CRUD/read (catalog, planning, analytics). Ports cuando hay ≥2 adapters o contrato cross-capability (`LEDGER_REPOSITORY`, `BUDGET_THRESHOLD_PORT`, extractor/FX).

Ledger mutators: una `prisma.$transaction` (fila + balances + `amountSpent` + outbox + threshold). Side effects (notif, IA, WS) **después** del commit vía outbox.

## Fuera de alcance (hoy)

- Open banking APIs
- Reconciliación automática contra cores bancarios
- `FinRecurringPattern` / `fin_recurring_patterns` — schema reservado, **sin REST, sin façade, sin tools**

## Auth de módulo

Rutas autenticadas `/api/finance/*` requieren `user_modules.finance.isEnabled`. Missing o false → **403** `Finance module is disabled`. Callback OAuth Gmail es `@Public()` (Google no envía Bearer).
