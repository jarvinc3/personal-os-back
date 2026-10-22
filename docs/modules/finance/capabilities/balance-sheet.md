# Capacidad: balance sheet

`GET /api/finance/balance-sheet`: patrimonio en la **moneda base del usuario** (`user_modules.config.baseCurrency`; env `BASE_CURRENCY` solo fallback). Es un snapshot: los selectores de periodo del dashboard **no** lo cambian.

## Composición

- **Disponible**: saldos de cuentas activas, incluido Efectivo.
- **Por cobrar**: cobros `PENDING`/`PARTIAL` no vencidos o vencidos hace 90 días o menos. Se suman al patrimonio (decisión web #207, ver `personal-os-web/docs/decisions/ADR-005-patrimonio-incluye-por-cobrar.md`).
- **Dudosos**: cobros vencidos hace más de 90 días. Se listan aparte y **no** suman.
- **Deudas**: utilización de tarjetas de crédito (`creditLimit - available`, nunca negativa) y saldo de préstamos activos.
- Las metas de ahorro no cambian el cálculo: su dinero ya vive en el saldo de una cuenta.

## Payload

- `global`, una fila por institución activa y `cash` conservan los campos del dashboard. `global.assets.accounts` incluye Efectivo; `global.assets.cash` es el subconjunto informativo y no se suma otra vez. `global.assets.receivables` sí se suma a `totalAssets` y `netWorth`.
- `global.byCurrency` y el `byCurrency` de cada institución traen los totales nativos por moneda (`assets`, `available`, `receivables`, `liabilities`, `netWorth`). No convierten: una institución con DOP y USD muestra dos líneas y la web no suma monedas distintas.
- `breakdown.byCurrency[]` agrupa una línea por producto (`accounts`, `cash`, `receivables`, `creditCards`, `loans`, `doubtfulReceivables`) con `balance` nativo y `balanceBase`. Cada grupo trae `totals` nativos y `totalsBase`; `breakdown.totals` es la suma de esos grupos en moneda base.
- Toda línea trae `hasDrift`, `driftDifference` (desviación abierta de integridad), `reconciliation` (`RECONCILED`/`PENDING` del mes en curso, o `NOT_APPLICABLE`) y, cuando aplica, `creditLimit`, `availableCredit` y `dueDate`.
- Los totales se calculan sumando las mismas líneas que se devuelven. Si falta una tasa o el límite de una tarjeta, el total afectado queda `null` y `status` pasa a `INCOMPLETE`; un descuadre o una conciliación pendiente **no** invalidan el total.
- `?detail=false` no existe todavía; si el payload crece, se agrega sin endpoint nuevo.

Evidencia: `balance-sheet/application/balance-sheet.service.ts`, `balance-sheet/domain/balance-sheet-breakdown.ts` y sus specs.
