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
- Cada línea trae `entity`: la entidad completa de su producto (cuenta, tarjeta, préstamo o cobro) con la misma forma que su endpoint propio, incluidos color, logo y datos de la institución, para que la web use la card canónica sin pedir cada entidad. Se resuelve con la consulta en lote de [entities.md](./entities.md): una consulta por tipo, no una por línea. `entity` no interviene en ningún cálculo y puede ser `null` si el producto ya no está disponible.
- Toda línea trae `hasDrift`, `driftDifference` (desviación abierta de integridad), `reconciliation` (`RECONCILED`/`PENDING` del mes en curso, o `NOT_APPLICABLE`) y, cuando aplica, `creditLimit`, `availableCredit` y `dueDate`.
- Los totales se calculan sumando las mismas líneas que se devuelven. Si falta una tasa o el límite de una tarjeta, el total afectado queda `null` y `status` pasa a `INCOMPLETE`; un descuadre o una conciliación pendiente **no** invalidan el total.
- `?detail=false` no existe todavía; si el payload crece, se agrega sin endpoint nuevo.

La conversión memoiza las tasas por par y fecha dentro de la petición: las líneas de la misma moneda reutilizan una sola consulta al puerto FX. El endpoint tiene `@Timeout` propio de 15 s, así que el límite global de 5 s no corta un balance con muchas posiciones.

Evidencia: `balance-sheet/application/balance-sheet.service.ts` con la foto (`balance-sheet-snapshot.ts`), las líneas por tipo (`balance-sheet-lines.ts`, `balance-sheet-receivables.ts`), el resumen de efectivo (`balance-sheet-cash.ts`) y los acumulados (`balance-sheet-buckets.ts`), `balance-sheet/domain/balance-sheet-breakdown.ts` y sus specs.
