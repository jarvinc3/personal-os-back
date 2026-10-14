# Capacidad: reconciliation

Cierra una cuenta o tarjeta contra el saldo real que muestra el banco. La
diferencia se registra como movimientos `ADJUSTMENT` categorizados, sin tocar
el tablero ni los presupuestos. Dirección del módulo:
`personal-os-web/docs/modules/finance/direccion-y-decisiones.md`.

## Rutas

| Path                                            | Notas                                                                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/finance/reconciliations/preview`     | No escribe. Devuelve `appBalance`, `difference` y `suggestedAdjustments[]` (0.15 % de las salidas del mes como `IMPUESTO_DGII`). |
| `POST /api/finance/reconciliations`             | Crea el cierre y sus ajustes en una transacción de BD. Suma de ajustes ≠ diferencia responde 422.                                |
| `GET /api/finance/reconciliations`              | Historial del producto (`accountId` o `cardId`, exactamente uno). Cursor + `limit`.                                              |
| `GET /api/finance/reconciliations/:id`          | Detalle del cierre.                                                                                                              |
| `DELETE /api/finance/reconciliations/:id`       | Solo el último cierre del producto. Revierte los ajustes vía diario de borrados y devuelve `undoId`.                             |
| `POST /api/finance/reconciliations/:id/restore` | Deshace el borrado sin doble efecto.                                                                                             |
| `GET /api/finance/reconciliations/status`       | Query `month=YYYY-MM`; lista productos conciliados y pendientes del mes.                                                         |
| `GET /api/finance/analytics/bank-charges`       | Totales por mes, institución y tipo de ajuste (ver `analytics.md`).                                                              |

## Modelo

- `FinReconciliation`: `id, userId, accountId?, cardId?, currency, asOfDate, appBalance, realBalance, difference, note?, createdAt`. Exactamente uno de `accountId`/`cardId` (check `num_nonnulls(...) = 1`). Una conciliación por moneda del producto.
- `FinReconciliationAdjustment`: `id, reconciliationId, transactionId, kind, amount`. FK al cierre en cascada y al movimiento en `RESTRICT`.
- `kind`: `IMPUESTO_DGII`, `COMISION`, `CARGO_PLASTICO`, `INTERES`, `OTRO`. Cada tipo apunta a una categoría de sistema (`TAX_DGII`, `FEE`, `PLASTIC_FEE`, `INTEREST`, `OTHER_BANK_CHARGE`).

## Reglas

- Montos en `Decimal`; la suma de los ajustes es exactamente la diferencia.
- Los ajustes nacen `CONFIRMED`, tipo `ADJUSTMENT`, fecha `asOfDate` y vínculo al cierre. `GET /transactions` los excluye por defecto (`includeAdjustments`); no cuentan en presupuestos ni en el gasto por categoría.
- `appBalance` es el saldo guardado del producto al momento de cerrar. Tras crear los ajustes, el saldo queda igual a `realBalance`.
- Borrar solo el último cierre del producto; el resto responde 422.
- Restaurar vuelve a crear el cierre, sus líneas y sus movimientos, y reaplica el saldo, sin duplicar el efecto.

## Evidencia

`packages/finance/src/reconciliation/`; migración
`20261019090000_fin_reconciliations`; e2e `test/finance.e2e-spec.ts`.
