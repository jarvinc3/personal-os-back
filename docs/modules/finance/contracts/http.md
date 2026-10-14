# Finance — HTTP

Base: `/api/finance`. Auth: Bearer + `@RequiresEnabledModule('finance')` salvo callback OAuth `@Public()`.

Envelope `{ data, meta }`.

## Controllers

| Área              | Controllers                                     |
| ----------------- | ----------------------------------------------- |
| Ledger            | `TransactionsController`, `TransfersController` |
| Catalog           | Institutions, Accounts, Cards, Categories       |
| Statements        | `CardStatementsController`                      |
| Import de estados | `StatementImportsController`                    |
| Planning          | Budgets, Savings, Loans, Receivables            |
| Analytics         | `AnalyticsController`                           |
| Balance sheet     | `BalanceSheetController`                        |
| FX                | `CurrenciesController`                          |
| Ingestion         | `EmailSyncController`                           |

## List shapes (`data`)

| Endpoint                                                                                                                                                                                                                                                      | Shape                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| GET transactions, budgets, budgets/:id/transactions, cards/:id/statements, accounts/:id/history, cards/:id/history, loans/:id/installments, receivables/:id/payments, savings-goals/:id/allocations y /contributions, email-sync/pending, email-sync/messages | `{ items, nextCursor, hasMore }`; query `cursor` + `limit` default 20 max 100                                |
| GET recycle-bin                                                                                                                                                                                                                                               | `{ archived, items, nextCursor, hasMore }`: `archived` completo; `items` (borrados) paginado por `deletedAt` |
| GET accounts, cards, institutions, categories, savings-goals, loans, receivables, email sources, email mailboxes, loans/:id/schedule                                                                                                                          | array                                                                                                        |
| GET analytics/*, balance-sheet                                                                                                                                                                                                                                | object                                                                                                       |

El cursor es opaco: codifica la fecha de orden y el id de la última fila. Las cuotas de préstamo van de más antigua a más nueva (`dueDate`); el resto, de más reciente a más antigua (`paidAt`, `contributedAt`, `createdAt`, `cycleEnd`, `deletedAt`).

Sources: sync logs nested `take: 5` (detail 10); nunca tokens. Mailboxes: `{ id, emailAddress, provider, isActive, createdAt, sources[] }`. `POST /sources` exige Gmail ya autorizado + `bankSenderEmail`; 409 si la institución ya tiene vínculo. `GET oauth/google/url` no exige `institutionId`.

## Rutas (resumen)

Ver inventario en código: `*controller.ts` bajo cada capability. Incluye `POST /api/finance/transactions/:id/reverse` y `/unconfirm`, `GET /api/finance/accounts/:id/history` + `/cards/:id/history`, `POST /api/finance/transfers` + `PATCH /api/finance/transfers/:id` + `POST /api/finance/transfers/:id/unconfirm` + `/confirm` + `DELETE /api/finance/transfers/:id`, `GET /api/finance/balance-sheet`, `GET /api/finance/cards/:id/statements`, `POST /api/finance/cards/:id/statements/import` + `POST /api/finance/accounts/:id/statements/import` + `GET`/`DELETE /api/finance/statement-imports/:id` + `PATCH /api/finance/statement-imports/:id/lines/:lineId` + `POST /api/finance/statement-imports/:id/apply`, `GET /api/finance/loans/:id` + `/installments`, `POST /api/finance/loans/:id/pay-next-installment`, `POST` + `DELETE /api/finance/savings-goals/:id/contributions[/:contributionId]`, `GET /api/finance/email-sync/mailboxes`, `GET /api/finance/email-sync/oauth/google/url` + `.../callback`.

## Edición y transferencias

Cada movimiento devuelve `editable`: `FULL` en `PENDING`, `METADATA` en `CONFIRMED` (categoría, comercio, descripción y notas), `NOTES` en revertidos, cancelados y rechazados. Cambiar un campo bloqueado responde 409 con `code` `TRANSACTION_LOCKED`, `TRANSACTION_IMMUTABLE` o `TRANSACTION_LINKED`. `POST /transactions/:id/unconfirm` revierte saldo y gasto y deja el movimiento `PENDING`. `GET /transactions` acepta `includeAdjustments`; por defecto los ajustes quedan fuera. También acepta `groupOperations`: con `true` cada transferencia vuelve como un ítem `{ kind: 'OPERATION', operationType: 'TRANSFER', legs: [...] }`, con todas sus patas dentro; con `false` (por defecto) vuelve la pata `SOURCE` con `transferTo*`.

Una transferencia es una operación atómica entre cuentas distintas; el destino tarjeta responde 400 `TRANSFER_TARGET_NOT_ACCOUNT` (se paga con la ruta de tarjeta, fase 03), la misma cuenta 400 `SAME_ACCOUNT` y una cuenta inexistente 404 `ACCOUNT_NOT_FOUND`. `fee` agrega una tercera pata `DEBIT` en el origen con la categoría del sistema "Comisiones bancarias" (sí cuenta como gasto y en el presupuesto); `rail` (`SAME_BANK`, `ACH`, `LBTR`, `OTHER`) estima la llegada; `destinationPending` crea la pata destino como `PENDING`. Solo se edita si todas las patas están `PENDING` (409 `TRANSFER_LOCKED`); `POST /transfers/:id/unconfirm` las pasa todas a `PENDING` y `/confirm` las confirma. El `legRole` de cada pata es `SOURCE`, `DESTINATION` o `FEE`; el listado solo muestra la pata `SOURCE` por operación.

Un pago de tarjeta (`POST /api/finance/card-payments`) es una operación de dos patas `CARD_PAYMENT`: la cuenta baja y el disponible de la tarjeta sube. No cuenta como gasto. Solo tarjetas `CREDIT` (400 `CARD_NOT_CREDIT`) y en una moneda con saldo en la tarjeta (400 `CARD_CURRENCY_MISSING`). Los cortes guardan `status` (`OPEN`, `CLOSED`, `PARTIAL`, `MINIMUM_PAID`, `PAID`, `OVERDUE`), `minimumPayment` (estimado a 1/36 del balance si no viene importado) y `paidAmount` calculado con los pagos de `(cycleEnd, dueDate]`.

Un préstamo sigue el sistema francés: `POST /loans/:id/pay-next-installment` reparte el pago en mora, cargos, seguro, interés y capital, y el saldo baja solo por capital. `POST /loans/:id/prepayments` abona a capital con `REDUCE_TERM` o `REDUCE_INSTALLMENT`; `GET /loans/:id/prepayments/preview` proyecta sin escribir. Errores 400 `PAYMENT_EXCEEDS_INSTALLMENT`, 409 `LOAN_HAS_OVERDUE` y 404 `LOAN_NOT_FOUND`.

Un cobro aplica el pago a lo pendiente; el excedente se resuelve con `excessHandling` (`EXTRA_INCOME` lo deja como ingreso con la categoría "Ingreso extra", `CREDIT_BALANCE` lo guarda como saldo a favor y `APPLY_TO_RECEIVABLE` lo aplica a otro cobro). Sin `excessHandling`, un pago mayor responde 422 `RECEIVABLE_EXCESS_UNRESOLVED`. `POST /receivables/:id/write-off` cierra el cobro como `WRITTEN_OFF` sin movimiento.

Un movimiento `CONFIRMED` sin vínculo se liga a una cuota, un cobro o una meta con `POST /api/finance/transactions/:id/link` (`kind` `LOAN_INSTALLMENT` | `RECEIVABLE_PAYMENT` | `SAVINGS_CONTRIBUTION` con el id del destino). No crea un movimiento nuevo: aplica el efecto con los casos de uso de planificación (paga la cuota repartiendo mora, cargos, seguro, interés y capital, registra el abono del cobro o el aporte a la meta). Un movimiento ya ligado o parte de una transferencia responde 409 `TRANSACTION_LINKED`; estado distinto de `CONFIRMED` o tipo, moneda o cuenta incompatible responde 409 `TRANSACTION_LINK_INVALID`; un importe que no cabe responde 400 `TRANSACTION_LINK_AMOUNT_INVALID`. `DELETE /api/finance/transactions/:id/link` quita el vínculo y revierte el efecto; sin vínculo responde 404 `TRANSACTION_NOT_LINKED`. El detalle del movimiento expone `planningLink { kind, targetId, label }`.

## Deshacer un borrado

Cada `DELETE` de una entidad de finance guarda un snapshot en `fin_deletion_journal` (`entityType`, `entityId`, `snapshot`, `sizeBytes`, `expiresAt`) dentro de la misma transacción, y devuelve `undoId`. `POST /api/finance/<entidad>/:id/restore` vuelve a crear las filas, repone los enlaces que la cascada anuló y aplica otra vez el saldo y el gasto del presupuesto que el borrado revirtió, solo para los movimientos `CONFIRMED` cuyo efecto se revirtió. Para una transferencia, `undoId` es el `transferGroupId` y se restaura completa. Restaurar dos veces responde 409 `ALREADY_RESTORED`, un choque con datos nuevos 409 `RESTORE_CONFLICT` y una operación incompleta 409 `PARTIAL_OPERATION`. Las entradas sin restaurar se purgan a los 30 días.

## Archivados y borrados

`GET /api/finance/recycle-bin` devuelve `{ archived, items, nextCursor, hasMore }`. `archived` son instituciones, cuentas, tarjetas y préstamos con `isActive:false` (`{ type, id, label }`), siempre completo. `items` son las entradas pendientes de `fin_deletion_journal` (`{ type, id, label, deletedAt }`) paginadas por `deletedAt`; `label` sale de la fila principal guardada y es `null` en un presupuesto, que no tiene nombre. Restaurar un archivado es `PATCH /api/finance/<entidad>/:id { isActive: true }`.

## Conciliación

`POST /api/finance/reconciliations/preview` calcula `difference = realBalance - appBalance` sin escribir y propone `IMPUESTO_DGII` con el 0.15 % de las salidas del mes más `OTRO` con el resto; con diferencia cero no propone líneas. `POST /api/finance/reconciliations` exige que la suma de los ajustes sea exactamente la diferencia (422 `UnprocessableEntityException` si no) y, con diferencia cero, registra el cierre sin movimientos. Un cierre por moneda del producto: una tarjeta con dos monedas se concilia dos veces.

`GET /api/finance/reconciliations?accountId|cardId` devuelve el historial paginado; `GET /reconciliations/status?month=YYYY-MM` marca cada producto como conciliado o pendiente del mes; `GET /api/finance/analytics/bank-charges` agrupa los ajustes por mes, institución y tipo. `DELETE /api/finance/reconciliations/:id` solo acepta el último cierre del producto (422 si no) y guarda un snapshot en el diario de borrados (`entityType` `reconciliation`); el cierre, sus líneas y sus movimientos vuelven con `POST /api/finance/reconciliations/:id/restore`. Los ajustes no aparecen en el tablero ni en presupuestos.

## Integridad de saldos

`GET /api/finance/integrity/check` recalcula el saldo esperado de cada cuenta y tarjeta desde sus movimientos `CONFIRMED` y compara con el guardado; sin query revisa todos los productos y con `accountId` o `cardId` (exactamente uno) solo ese. Registra cada desviación abierta en `fin_balance_drifts` y devuelve `{ drifts: [...] }` con nombres y montos como strings. `POST /api/finance/integrity/recalculate` exige `accountId`, o `cardId` con `currency` (400 si falta), corrige el saldo guardado a la suma de los movimientos y cierra las desviaciones abiertas del producto en una sola transacción; no crea movimientos. Un `accountId`/`cardId` sin producto responde 404.
