# Finance — HTTP

Base: `/api/finance`. Auth: Bearer + `@RequiresEnabledModule('finance')` salvo callback OAuth `@Public()`.

Envelope `{ data, meta }`.

## Controllers

| Área               | Controllers                                                                            |
| ------------------ | -------------------------------------------------------------------------------------- |
| Ledger             | `TransactionsController`, `TransfersController`                                        |
| Catalog            | Institutions, Accounts, Cards, Categories                                              |
| Statements         | `CardStatementsController`                                                             |
| Import de estados  | `StatementImportsController`                                                           |
| Import de correo   | `ImportReviewController`                                                               |
| Planning           | Budgets, Savings, Loans, Receivables                                                   |
| Cobros compartidos | `ReceivableSharesController` (auth) y `PublicReceivableSharesController` (`@Public()`) |
| Analytics          | `AnalyticsController`                                                                  |
| Balance sheet      | `BalanceSheetController`                                                               |
| FX                 | `CurrenciesController`                                                                 |

## List shapes (`data`)

| Endpoint                                                                                                                                                                                                             | Shape                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| GET transactions, budgets, budgets/:id/transactions, cards/:id/statements, accounts/:id/history, cards/:id/history, loans/:id/installments, receivables/:id/payments, savings-goals/:id/allocations y /contributions | `{ items, nextCursor, hasMore }`; query `cursor` + `limit` default 20 max 100                                |
| GET recycle-bin                                                                                                                                                                                                      | `{ archived, items, nextCursor, hasMore }`: `archived` completo; `items` (borrados) paginado por `deletedAt` |
| GET accounts, cards, institutions, savings-goals, loans, receivables                                                                                                                                                 | `{ items, nextCursor, hasMore }`; query `cursor` + `limit` default 20 max 100                                |
| GET categories, loans/:id/schedule, receivable-shares                                                                                                                                                                | array                                                                                                        |
| GET analytics/*, balance-sheet                                                                                                                                                                                       | object                                                                                                       |

El cursor es opaco: codifica la fecha de orden y el id de la última fila. Las cuotas de préstamo van de más antigua a más nueva (`dueDate`); el resto, de más reciente a más antigua (`paidAt`, `contributedAt`, `createdAt`, `cycleEnd`, `deletedAt`). Cuentas ordenan por `name` y el cursor de instituciones codifica `sortOrder` + `name`; el resto de las listas nuevas usa `createdAt` o `nextDueDate`.

## Prefijo de rutas

Cada recurso vive bajo `finance/<recurso>` (por ejemplo `finance/bank-charges`, no `finance/analytics/bank-charges`). `finance/analytics` agrupa solo los resúmenes (`analytics/*`); los catálogos y operaciones no se montan bajo analítica. El mismo criterio aplica fuera de finance: `ai/sessions`, `ai/actions`, `ai/sessions/:id/actions`.

## Rutas (resumen)

Ver inventario en código: `*controller.ts` bajo cada capability. Incluye `POST /api/finance/transactions/:id/reverse` y `/unconfirm`, `GET /api/finance/accounts/:id/history` + `/cards/:id/history`, `POST /api/finance/transfers` + `PATCH /api/finance/transfers/:id` + `POST /api/finance/transfers/:id/unconfirm` + `/confirm` + `/reverse` + `DELETE /api/finance/transfers/:id`, `GET /api/finance/balance-sheet`, `POST /api/finance/entities/lookup`, `GET /api/finance/cards/:id/statements`, `POST /api/finance/cards/:id/statements/import` + `POST /api/finance/accounts/:id/statements/import` + `GET`/`DELETE /api/finance/statement-imports/:id` + `PATCH /api/finance/statement-imports/:id/lines/:lineId` + `POST /api/finance/statement-imports/:id/apply`, `GET /api/finance/loans/:id` + `/installments`, `POST /api/finance/loans/:id/pay-next-installment`, `POST` + `DELETE /api/finance/savings-goals/:id/contributions[/:contributionId]`.

## Resolución de importaciones en revisión

| Método y ruta                                  | Qué hace                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `GET /api/finance/imports/review`              | Lista hasta 100 imports en `REVIEW_REQUIRED` con motivo y candidato. |
| `POST /api/finance/imports/review/:id/resolve` | Aplica una decisión humana al import.                                |

Cuerpo de `resolve`:

| `action`          | Campos                           | Resultado                                                                                       |
| ----------------- | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `SET_DATE`        | `transactionDate` (ISO)          | Registra el movimiento con esa fecha.                                                           |
| `SET_DESTINATION` | `accountId`, `cardId` o ambos    | Registra contra el producto elegido; en un pago de tarjeta, `accountId` es la cuenta de origen. |
| `LINK_REVERSAL`   | `originalTransactionId`          | Enlaza el reverso sin duplicar el movimiento.                                                   |
| `DISCARD`         | `reason` (obligatorio, 500 máx.) | Pasa a `DISMISSED` sin crear movimiento.                                                        |

Una misma petición puede incluir varias correcciones (por ejemplo `transactionDate` y `accountId`); se aplican juntas. La resolución y el descarte se serializan con un bloqueo por usuario.

Errores: 400 dato faltante o inválido, 404 import o producto inexistente, 409 el import ya no está en revisión, 422 la decisión no resuelve el import (el motivo vuelve en el cuerpo y el ledger no cambia).

## Edición y transferencias

Cada movimiento devuelve `editable`: `FULL` en `PENDING`, `METADATA` en `CONFIRMED` (categoría, comercio, descripción y notas), `NOTES` en revertidos, cancelados y rechazados. Cambiar un campo bloqueado responde 409 con `code` `TRANSACTION_LOCKED`, `TRANSACTION_IMMUTABLE` o `TRANSACTION_LINKED`. `POST /transactions/:id/unconfirm` revierte saldo y gasto y deja el movimiento `PENDING`. `GET /transactions` acepta `includeAdjustments`; por defecto los ajustes quedan fuera. También acepta `groupOperations`: con `true` cada transferencia vuelve como un ítem `{ kind: 'OPERATION', operationType: 'TRANSFER', legs: [...] }`, con todas sus patas dentro; con `false` (por defecto) vuelve la pata `SOURCE` con `transferTo*`.

Una transferencia es una operación atómica entre cuentas distintas; el destino tarjeta responde 400 `TRANSFER_TARGET_NOT_ACCOUNT` (se paga con la ruta de tarjeta, fase 03), la misma cuenta 400 `SAME_ACCOUNT` y una cuenta inexistente 404 `ACCOUNT_NOT_FOUND`. `fee` agrega una tercera pata `DEBIT` en el origen con la categoría del sistema "Comisiones bancarias" (sí cuenta como gasto y en el presupuesto); `rail` (`SAME_BANK`, `ACH`, `LBTR`, `OTHER`) estima la llegada; `destinationPending` crea la pata destino como `PENDING`. `exchangeRate` (tasa par origen→destino) y `receivedAmount` (monto que entra en la cuenta destino) fijan la pata destino; si vienen ambos, manda `receivedAmount`. Sin ninguno de los dos se usa la tasa del día y la operación queda `isEstimated`. El detalle expone `transferToAmount`, `transferToCurrency`, `exchangeRate` y `transferEstimated`. Los pagos de tarjeta también vuelven como una operación `TRANSFER` en el listado y en el historial de ambos productos. Solo se edita si todas las patas están `PENDING` (409 `TRANSFER_LOCKED`); `POST /transfers/:id/unconfirm` las pasa todas a `PENDING`, `/confirm` las confirma y `/reverse` las marca `REVERSED` revirtiendo saldo y presupuesto (409 `TRANSFER_NOT_COMPLETED` si alguna no está completada). El `legRole` de cada pata es `SOURCE`, `DESTINATION` o `FEE`; el listado solo muestra la pata `SOURCE` por operación.

Un pago de tarjeta (`POST /api/finance/card-payments`) es una operación de dos patas `CARD_PAYMENT`: la cuenta baja y el disponible de la tarjeta sube. No cuenta como gasto. Solo tarjetas `CREDIT` (400 `CARD_NOT_CREDIT`) y en una moneda con saldo en la tarjeta (400 `CARD_CURRENCY_MISSING`). Los cortes guardan `status` (`OPEN`, `CLOSED`, `PARTIAL`, `MINIMUM_PAID`, `PAID`, `OVERDUE`), `minimumPayment` (estimado a 1/36 del balance si no viene importado) y `paidAmount` calculado con los pagos de `(cycleEnd, dueDate]`.

La importación por correo de una transferencia o de un pago de tarjeta no agrega endpoints: usa la misma semántica de ledger y la señal existente. El contrato está en [email-import.md](./email-import.md): la transferencia de una pata está implementada y el resto sigue `NO_IMPLEMENTADO`. La ruta manual conserva su endpoint y sus dos patas; la opción de un 409 con confirmación explícita ante un pago parecido queda PENDIENTE CONCRETAR y no se presenta como acuerdo.

Un préstamo guarda un `name` opcional y, al crearlo, un `disbursementAccountId` opcional: el capital entra a esa cuenta como `ADJUSTMENT` (sube el saldo, no cuenta como ingreso) y queda ligado por `disbursementTransactionId`. La cuenta de desembolso debe estar activa y en la moneda del préstamo; el detalle devuelve `disbursementAccount { id, name }`. Un préstamo sigue el sistema francés: `POST /loans/:id/pay-next-installment` reparte el pago en mora, cargos, seguro, interés y capital, y el saldo baja solo por capital. `POST /loans/:id/prepayments` abona a capital con `REDUCE_TERM` o `REDUCE_INSTALLMENT`; `GET /loans/:id/prepayments/preview` proyecta sin escribir. Errores 400 `PAYMENT_EXCEEDS_INSTALLMENT`, 409 `LOAN_HAS_OVERDUE` y 404 `LOAN_NOT_FOUND`.

Una asignación a una meta con `kind: WITHDRAWAL` exige `toAccountId` (400 `GOAL_WITHDRAWAL_ACCOUNT_REQUIRED`), no puede superar `currentAmount` (409 `GOAL_WITHDRAWAL_EXCEEDS_AVAILABLE`) y mueve el dinero con una transferencia; la fila guarda `destinationAccountId` y el `transferGroupId`, sin `transactionId`, para que el retiro siempre reste al progreso. Archivar una cuenta con dinero apartado responde 409 `ACCOUNT_HAS_GOAL_MONEY`.

Un cobro aplica el pago a lo pendiente; el excedente se resuelve con `excessHandling` (`EXTRA_INCOME` lo deja como ingreso con la categoría "Ingreso extra", `CREDIT_BALANCE` lo guarda como saldo a favor y `APPLY_TO_RECEIVABLE` lo aplica a otro cobro). Sin `excessHandling`, un pago mayor responde 422 `RECEIVABLE_EXCESS_UNRESOLVED`. `POST /receivables/:id/write-off` cierra el cobro como `WRITTEN_OFF` sin movimiento.

Un movimiento `CONFIRMED` sin vínculo se liga a una cuota, un cobro o una meta con `POST /api/finance/transactions/:id/link` (`kind` `LOAN_INSTALLMENT` | `RECEIVABLE_PAYMENT` | `SAVINGS_CONTRIBUTION` con el id del destino). No crea un movimiento nuevo: aplica el efecto con los casos de uso de planificación (paga la cuota repartiendo mora, cargos, seguro, interés y capital, registra el abono del cobro o el aporte a la meta). Un movimiento ya ligado o parte de una transferencia responde 409 `TRANSACTION_LINKED`; estado distinto de `CONFIRMED` o tipo, moneda o cuenta incompatible responde 409 `TRANSACTION_LINK_INVALID`; un importe que no cabe responde 400 `TRANSACTION_LINK_AMOUNT_INVALID`. `DELETE /api/finance/transactions/:id/link` quita el vínculo y revierte el efecto; sin vínculo responde 404 `TRANSACTION_NOT_LINKED`. El detalle del movimiento expone `planningLink { kind, targetId, label }`.

## Deshacer un borrado

Cada `DELETE` de una entidad de finance guarda un snapshot en `fin_deletion_journal` (`entityType`, `entityId`, `snapshot`, `sizeBytes`, `expiresAt`) dentro de la misma transacción, y devuelve `undoId`. `POST /api/finance/<entidad>/:id/restore` vuelve a crear las filas, repone los enlaces que la cascada anuló y aplica otra vez el saldo y el gasto del presupuesto que el borrado revirtió, solo para los movimientos `CONFIRMED` cuyo efecto se revirtió. Para una transferencia, `undoId` es el `transferGroupId` y se restaura completa. Restaurar dos veces responde 409 `ALREADY_RESTORED`, un choque con datos nuevos 409 `RESTORE_CONFLICT` y una operación incompleta 409 `PARTIAL_OPERATION`. Las entradas sin restaurar se purgan a los 30 días.

## Archivados y borrados

`GET /api/finance/recycle-bin` devuelve `{ archived, items, nextCursor, hasMore }`. `archived` son instituciones, cuentas, tarjetas y préstamos con `isActive:false` (`{ type, id, label }`), siempre completo. `items` son las entradas pendientes de `fin_deletion_journal` (`{ type, id, label, deletedAt }`) paginadas por `deletedAt`; `label` sale de la fila principal guardada y es `null` en un presupuesto, que no tiene nombre. Restaurar un archivado es `PATCH /api/finance/<entidad>/:id { isActive: true }`.

## Conciliación

`POST /api/finance/reconciliations/preview` calcula `difference = realBalance - appBalance` sin escribir y propone `IMPUESTO_DGII` con el 0.15 % de las salidas del mes más `OTRO` con el resto; con diferencia cero no propone líneas. `POST /api/finance/reconciliations` exige que la suma de los ajustes sea exactamente la diferencia (422 `UnprocessableEntityException` si no) y, con diferencia cero, registra el cierre sin movimientos. Un cierre por moneda del producto: una tarjeta con dos monedas se concilia dos veces.

`GET /api/finance/reconciliations?accountId|cardId` devuelve el historial paginado; `GET /reconciliations/status?month=YYYY-MM` marca cada producto como conciliado o pendiente del mes; `GET /api/finance/bank-charges` agrupa los ajustes por mes, institución y tipo. `DELETE /api/finance/reconciliations/:id` solo acepta el último cierre del producto (422 si no) y guarda un snapshot en el diario de borrados (`entityType` `reconciliation`); el cierre, sus líneas y sus movimientos vuelven con `POST /api/finance/reconciliations/:id/restore`. Los ajustes no aparecen en el tablero ni en presupuestos.

## Cobros compartidos

`POST /api/finance/receivable-shares` (`receivableIds` 1-50 sin duplicados, `debtorName`) respeta `Idempotency-Key`, exige que todo cobro sea del usuario (404 `RECEIVABLE_SHARE_RECEIVABLE_NOT_FOUND` si no) y devuelve `{ id, token, url, debtorName, isActive, expiresAt, createdAt, items }`; `url` se arma con `PUBLIC_WEB_URL` y la ruta web `/c/<token>`; sin esa variable usa el primer origin de `CORS_ORIGIN`. `GET /api/finance/receivable-shares` lista los links del usuario (activos y revocados) con `itemCount`. `PATCH /api/finance/receivable-shares/:id/revoke` marca `isActive=false` y `revokedAt`; `PATCH /api/finance/receivable-shares/:id/regenerate` rota el token y reactiva.

`GET /api/public/receivable-shares/:token` no exige auth, va limitado a 30 peticiones por minuto y por IP y responde `X-Robots-Tag: noindex`. Falta, inactivo, revocado o vencido dan el mismo 404 genérico (`RECEIVABLE_SHARE_NOT_FOUND`). El payload trae `ownerFirstName`, `debtorName`, `updatedAt`, `totalsByCurrency` (una entrada por moneda, sin convertir) e `items` (`ref` opaco, `concept`, `createdAt`, `dueDate`, `amount`, `paid`, `pending`, `currency`, `status`, `note`, `payments`). No expone cuentas, instituciones, transacciones, ids internos ni el email del dueño; `CANCELLED` y `WRITTEN_OFF` se excluyen.

## Integridad de saldos

`GET /api/finance/integrity/check` recalcula el saldo esperado de cada cuenta y tarjeta desde sus movimientos `CONFIRMED` y compara con el guardado; sin query revisa todos los productos y con `accountId` o `cardId` (exactamente uno) solo ese. Registra cada desviación abierta en `fin_balance_drifts` y devuelve `{ drifts: [...] }` con nombres y montos como strings. `POST /api/finance/integrity/recalculate` exige `accountId`, o `cardId` con `currency` (400 si falta), corrige el saldo guardado a la suma de los movimientos y cierra las desviaciones abiertas del producto en una sola transacción; no crea movimientos. Un `accountId`/`cardId` sin producto responde 404.
