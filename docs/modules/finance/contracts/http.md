# Finance — HTTP

Base: `/api/finance`. Auth: Bearer + `@RequiresEnabledModule('finance')` salvo callback OAuth `@Public()`.

Envelope `{ data, meta }`.

## Controllers

| Área          | Controllers                                     |
| ------------- | ----------------------------------------------- |
| Ledger        | `TransactionsController`, `TransfersController` |
| Catalog       | Institutions, Accounts, Cards, Categories       |
| Statements    | `CardStatementsController`                      |
| Planning      | Budgets, Savings, Loans, Receivables            |
| Analytics     | `AnalyticsController`                           |
| Balance sheet | `BalanceSheetController`                        |
| FX            | `CurrenciesController`                          |
| Ingestion     | `EmailSyncController`                           |

## List shapes (`data`)

| Endpoint                                                                                                                                                                | Shape                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| GET transactions, budgets                                                                                                                                               | `{ items, nextCursor, hasMore }`; query `cursor` + `limit` default 20 max 100 |
| GET accounts, cards, institutions, categories, savings-goals, loans, receivables, email sources, pending, email mailboxes, cards/:id/statements, loans/:id/installments | array                                                                         |
| GET analytics/*, balance-sheet                                                                                                                                          | object                                                                        |
| GET recycle-bin                                                                                                                                                         | object `{ archived, deleted }`                                                |

Sources: sync logs nested `take: 5` (detail 10); nunca tokens. Mailboxes: `{ id, emailAddress, provider, isActive, createdAt, sources[] }`. `POST /sources` exige Gmail ya autorizado + `bankSenderEmail`; 409 si la institución ya tiene vínculo. `GET oauth/google/url` no exige `institutionId`.

## Rutas (resumen)

Ver inventario en código: `*controller.ts` bajo cada capability. Incluye `POST /api/finance/transactions/:id/reverse` y `/unconfirm`, `GET /api/finance/accounts/:id/history` + `/cards/:id/history`, `POST /api/finance/transfers` + `PATCH /api/finance/transfers/:id` + `POST /api/finance/transfers/:id/unconfirm`, `GET /api/finance/balance-sheet`, `GET /api/finance/cards/:id/statements`, `GET /api/finance/loans/:id` + `/installments`, `POST /api/finance/loans/:id/pay-next-installment`, `POST` + `DELETE /api/finance/savings-goals/:id/contributions[/:contributionId]`, `GET /api/finance/email-sync/mailboxes`, `GET /api/finance/email-sync/oauth/google/url` + `.../callback`.

## Edición y transferencias

Cada movimiento devuelve `editable`: `FULL` en `PENDING`, `METADATA` en `CONFIRMED` (categoría, comercio, descripción y notas), `NOTES` en revertidos, cancelados y rechazados. Cambiar un campo bloqueado responde 409 con `code` `TRANSACTION_LOCKED`, `TRANSACTION_IMMUTABLE` o `TRANSACTION_LINKED`. `POST /transactions/:id/unconfirm` revierte saldo y gasto y deja el movimiento `PENDING`. `GET /transactions` acepta `includeAdjustments`; por defecto los ajustes quedan fuera.

Una transferencia es una operación atómica entre cuentas distintas. `fee` agrega una tercera pata `DEBIT` en el origen con la categoría del sistema "Comisiones bancarias" (sí cuenta como gasto); `rail` (`SAME_BANK`, `ACH`, `LBTR`, `OTHER`) estima la llegada; `destinationPending` crea la pata destino como `PENDING`. Solo se edita si todas las patas están `PENDING` (409 `TRANSFER_LOCKED`); `POST /transfers/:id/unconfirm` las pasa todas a `PENDING`. El `legRole` de cada pata es `SOURCE`, `DESTINATION` o `FEE`.

## Deshacer un borrado

Cada `DELETE` de una entidad de finance guarda un snapshot en `fin_deletion_journal` (`entityType`, `entityId`, `snapshot`) dentro de la misma transacción, y devuelve `undoId`. `POST /api/finance/<entidad>/:id/restore` vuelve a crear las filas, repone los enlaces que la cascada anuló y aplica otra vez el saldo y el gasto del presupuesto que el borrado revirtió. Para una transferencia, `undoId` es el `transferGroupId`.

## Archivados y borrados

`GET /api/finance/recycle-bin` devuelve `{ archived, deleted }`. `archived` son instituciones, cuentas, tarjetas y préstamos con `isActive:false` (`{ type, id, label }`). `deleted` son las entradas pendientes de `fin_deletion_journal` (`{ type, id, label, deletedAt }`); `label` sale de la fila principal guardada y es `null` en un presupuesto, que no tiene nombre. Restaurar un archivado es `PATCH /api/finance/<entidad>/:id { isActive: true }`.
