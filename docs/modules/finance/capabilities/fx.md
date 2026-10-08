# Capacidad: FX

Adapter `exchangerate.host` + cache `FinExchangeRate` (par + **fecha exacta**). Fail-closed 400 si falta tasa del `transactionDate` o de hoy UTC para balance-sheet.

`GET /api/finance/currencies` lista soportadas.

`GET /api/finance/exchange-rates?base=DOP&quotes=USD,EUR` devuelve la tasa de cada quote en `base` con fecha de **hoy UTC**; tasa ausente → `rate: null` (fail-open de display).

`POST /api/finance/base-currency` body `{ baseCurrency }` cambia la principal y recalcula en una transacción los `amountBaseCurrency` de las transacciones del usuario, el `amountLimit`/`amountSpent` de sus presupuestos y el config del módulo. Si falta una tasa → 400 sin escribir nada; mismo código → 200 no-op. Emite `module.config.updated`.

`ResolveUserBaseCurrencyUseCase` resuelve la base desde `user_modules.config.baseCurrency` (ISO-3) y cae al env `BASE_CURRENCY` si falta o es inválido. `ResolveAmountsUseCase` recibe la base explícita; los callers la resuelven una vez por request.

Env: `EXCHANGE_RATE_HOST_API_KEY`, `BASE_CURRENCY` (solo fallback).
