# Capacidad: balance sheet

`GET /api/finance/balance-sheet`: activos (cuentas activas) menos utilización de crédito y préstamos activos, a la **moneda base del usuario** (`user_modules.config.baseCurrency`; env `BASE_CURRENCY` solo fallback). Payload `global` + una fila por institución activa. Cash/loans sin institución solo en `global`. Incomplete credit cards null `netWorth` / `creditCards`.

Period selectors del dashboard **no** cambian este snapshot.

Evidencia: `balance-sheet/application/balance-sheet.service.ts` + spec.
