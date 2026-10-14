# Capacidad: integrity

Comprueba el invariante **I1**: el saldo guardado de cada cuenta y tarjeta es
siempre la suma de sus movimientos confirmados. No es una conciliación contra
el banco (ver `reconciliation.md`): es la app comprobando que no se contradice a
sí misma. Dirección del módulo:
`personal-os-web/docs/modules/finance/direccion-y-decisiones.md`.

## Rutas

| Path                                      | Notas                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/finance/integrity/check`        | Compara y **registra** las desviaciones abiertas. Query opcional `accountId` o `cardId` (exactamente uno).                    |
| `POST /api/finance/integrity/recalculate` | Corrige el saldo guardado a la suma de los movimientos y cierra la desviación. Body `{ accountId }` o `{ cardId, currency }`. |

## Modelo

- `FinBalanceDrift`: `id, userId, accountId?, cardId?, currency, storedBalance, expectedBalance, difference, detectedAt, resolvedAt?`. Exactamente uno de `accountId`/`cardId` (check `num_nonnulls(...) = 1`). `difference = expectedBalance - storedBalance`.
- Una fila abierta (`resolvedAt = null`) por producto y moneda; el check actualiza la existente o crea una. `recalculate` marca `resolvedAt`.

## Reglas

- Todo el dinero en `Decimal`; la comparación es exacta. El dominio suma centavos enteros y replica las mismas reglas que el ledger incremental (`ledger/infrastructure/balance.helpers.ts`).
- El saldo esperado es la suma de los movimientos `CONFIRMED`. Los `PENDING` y los `REVERTED` no cuentan; una reversa marca el original `REVERSED`, así que netea sola. Aportes a meta no mueven el saldo de la cuenta.
- Por tipo: ingreso suma; gasto resta; transferencia resta en origen (más la comisión) y suma en destino; pago de tarjeta resta en la cuenta y reduce la deuda de la tarjeta; pago de préstamo resta en la cuenta; ajuste suma o resta. Un movimiento de tarjeta de débito cae en su cuenta enlazada; un ajuste o pago de tarjeta cae en la fila de saldo de la tarjeta.
- El recálculo corre dentro de la misma transacción de BD que la corrección.
- `BalanceIntegrityScheduler` (4:00) recorre los productos de cada usuario y emite `finance.balance.drift_detected` por desviación nueva o cambiada. La notificación usa la clave `notifications.balanceIntegrity`.
- La migración crea la tabla sin filas: no introduce drift.

## Evidencia

`packages/finance/src/integrity/`; migración
`20261020120000_fin_balance_drifts`; e2e `test/finance.e2e-spec.ts`;
dominio `integrity/domain/expected-balance.ts`.
