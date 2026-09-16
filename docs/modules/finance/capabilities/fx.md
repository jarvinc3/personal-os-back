# Capacidad: FX

Adapter `exchangerate.host` + cache `FinExchangeRate` (par + **fecha exacta**). Fail-closed 400 si falta tasa del `transactionDate` o de hoy UTC para balance-sheet.

`GET /api/finance/currencies` lista soportadas.

Env: `EXCHANGE_RATE_HOST_API_KEY`, `BASE_CURRENCY`.
