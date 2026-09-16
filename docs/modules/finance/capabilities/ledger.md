# Capacidad: ledger

Campos de importe: `amount`/`currency` original; `ledgerAmount`/`ledgerCurrency` aplicado al saldo; `amountBaseCurrency`/`exchangeRate` para analytics (`BASE_CURRENCY`).

`GET /api/finance/transactions` paginado `{ items, pagination }` default page=1 limit=20 max 100. Filtros: fechas, cuenta, tarjeta, categoría, tipo, status, search, `transferGroupId`.

Writes: create DEBIT/CREDIT, PATCH metadata/update, confirm, reverse, DELETE, `POST /transfers`.

**AC-FIN-001:** Given cuenta DOP y DEBIT USD CONFIRMED, When create, Then `ledgerAmount` ≠ raw amount si hay FX del día.

**AC-FIN-002:** Given PENDING, When confirm, Then CONFIRMED y saldo movido.

Evidencia: `ledger/application/*use-case.ts` y specs.
