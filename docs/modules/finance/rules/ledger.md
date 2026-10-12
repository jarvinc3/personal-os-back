# Reglas de ledger

| ID           | Condición                                                  | Resultado                                                                                                                      | Evidencia               |
| ------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `BR-FIN-001` | Status ≠ `CONFIRMED`                                       | No muta balances materializados ni `amountSpent`                                                                               | `statusAffectsLedger`   |
| `BR-FIN-002` | Transacción                                                | Exactamente uno de `accountId` o `cardId` (XOR)                                                                                | DTO + domain            |
| `BR-FIN-003` | Tarjeta CREDIT                                             | Sin `accountId`; mueve `FinCardBalance` por moneda                                                                             | catalog/ledger          |
| `BR-FIN-004` | Tarjeta DEBIT                                              | Requiere `accountId` mismo usuario e institución; mueve la cuenta, no el balance de tarjeta                                    |                         |
| `BR-FIN-005` | `CHECKING`/`SAVINGS`/`INVESTMENT`                          | Exigen institución; `CASH` puede omitirla                                                                                      |                         |
| `BR-FIN-006` | Archivar institución con dependencias activas              | 409 + `details.dependents`                                                                                                     | catalog                 |
| `BR-FIN-007` | Cambio institución de cuenta con debit cards incompatibles | 409 + `details.debitCardIds`                                                                                                   |                         |
| `BR-FIN-008` | FX                                                         | `amount` original + `ledgerAmount` + `amountBaseCurrency`; tasa **exacta** del día o 400 (fail-closed, sin “latest”)           | `ResolveAmountsUseCase` |
| `BR-FIN-009` | Confirm PENDING                                            | Aplica saldo + `amountSpent`                                                                                                   | confirm use-case        |
| `BR-FIN-010` | Delete CONFIRMED                                           | Compensa saldo y budget en la misma TX; outbox `finance.transaction.deleted`                                                   | delete use-case         |
| `BR-FIN-011` | Reverse                                                    | Solo `CONFIRMED` no-transfer; idempotente si ya `REVERSED`; una pata de transfer → 400. Gmail puede llamar el use-case directo | reverse use-case        |
| `BR-FIN-012` | Monedas                                                    | ISO 4217 3 letras                                                                                                              |                         |
| `BR-FIN-013` | Manual create                                              | Default `CONFIRMED`, `source=MANUAL`; AI tools `source=AI`                                                                     |                         |
| `BR-FIN-014` | `POST /transactions` type                                  | Solo `DEBIT`\|`CREDIT`; transfers → `POST /transfers`                                                                          |                         |
| `BR-FIN-015` | Umbral presupuesto                                         | Una alerta por `(budgetId, type)` en `FinBudgetAlert`                                                                          |                         |
| `BR-FIN-016` | Money JSON                                                 | Responses: money/rates **strings** (`decimalToString`). Writes: `@IsNumber`. Percentajes: number                               | mappers                 |
| `BR-FIN-017` | Copy “Completado”                                          | Enum `CONFIRMED` (no existe `COMPLETED`)                                                                                       |                         |
| `BR-FIN-018` | Email `emailSync.enabled`                                  | Debe ser true para OAuth/conectar/sync manual                                                                                  | ingestion               |
| `BR-FIN-019` | Email `emailSync.automatic`                                | Debe ser true (y enabled) para cron/boot/enqueue al ligar                                                                      | ingestion               |

## Bank status → interno (email)

`shared/domain/transaction-status.ts`. Confidence &lt; 0.7 o `UNKNOWN` → `PENDING`. `APPROVED`/`COMPLETED`/`POSTED` → `CONFIRMED`. `PENDING`/`IN_PROGRESS`/`AUTHORIZED` → `PENDING`. `DECLINED`/`REJECTED`/`FAILED` → `DECLINED`. `CANCELLED`/`VOIDED` → `CANCELLED`. `REVERSED`/`REFUNDED`/`CHARGEBACK` → reverse original si existe + `REVERSED`.
