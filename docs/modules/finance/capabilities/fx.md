# Capacidad: FX

Adapter `exchangerate.host` + cache `FinExchangeRate` (par + **fecha exacta**).

La cotización de presentación (`getHistoricalRate`) usa solo la fecha exacta: si no hay tasa para hoy, `GET /api/finance/exchange-rates` devuelve `rate: null` y nunca inventa una fecha anterior. Así la comprobación de la clave del proveedor no se enmascara.

La conversión del ledger (`getLedgerRate`) usa la fecha exacta cuando existe. En fines de semana y feriados, o cuando el proveedor no publica esa fecha, usa la última tasa publicada en o antes y devuelve `rateDate` con la fecha realmente aplicada. El importe guarda `exchangeRateDate` en `aiMetadata`, y para la moneda base añade `baseExchangeRate` y `baseExchangeRateDate`; el valor del ledger sigue en la columna `exchangeRate`.

Si el proveedor falla, el resultado conserva la causa: `PROVIDER_UNAUTHORIZED` (401/403), `PROVIDER_UNAVAILABLE` (red, 429 o 5xx), `API_KEY_MISSING`, `PROVIDER_ERROR` (respuesta inesperada) o `NO_EXACT_RATE` (no hay tasa exacta ni anterior). El ledger responde 503 para los fallos de proveedor o configuración y 400 solo cuando de verdad no hay tasa; nunca presenta un 401 como «No exact-date rate».

El importe base y el ledger usan `ResolveAmountsUseCase`; el detalle de la tasa usada viaja a `aiMetadata` de la transacción importada.

`GET /api/finance/currencies` lista soportadas.

`GET /api/finance/exchange-rates?base=DOP&quotes=USD,EUR` devuelve la tasa de cada quote en `base` con fecha de **hoy UTC**; tasa ausente → `rate: null` (fail-open de display).

`POST /api/finance/base-currency` body `{ baseCurrency }` cambia la principal y recalcula en una transacción los `amountBaseCurrency` de las transacciones del usuario, el `amountLimit`/`amountSpent` de sus presupuestos y el config del módulo. Usa la última tasa publicada en o antes cuando el día no tiene cotización; si no hay tasa exacta ni anterior → 400 sin escribir nada; si el proveedor falla o la clave no está configurada → 503 con la causa real; mismo código → 200 no-op. Emite `module.config.updated`.

`ResolveUserBaseCurrencyUseCase` resuelve la base desde `user_modules.config.baseCurrency` (ISO-3) y cae al env `BASE_CURRENCY` si falta o es inválido. `ResolveAmountsUseCase` recibe la base explícita; los callers la resuelven una vez por request.

Env: `EXCHANGE_RATE_HOST_API_KEY`, `BASE_CURRENCY` (solo fallback).
