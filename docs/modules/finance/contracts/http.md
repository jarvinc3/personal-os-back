# Finance — HTTP

Base: `/api/finance`. Auth: Bearer + `@RequiresEnabledModule('finance')` salvo callback OAuth `@Public()`.

Envelope `{ data, meta }`.

## Controllers

| Área | Controllers |
| --- | --- |
| Ledger | `TransactionsController`, `TransfersController` |
| Catalog | Institutions, Accounts, Cards, Categories |
| Statements | `CardStatementsController` |
| Planning | Budgets, Savings, Loans, Receivables |
| Analytics | `AnalyticsController` |
| Balance sheet | `BalanceSheetController` |
| FX | `CurrenciesController` |
| Ingestion | `EmailSyncController` |

## List shapes (`data`)

| Endpoint | Shape |
| --- | --- |
| GET transactions, budgets | `{ items, nextCursor, hasMore }`; query `cursor` + `limit` default 20 max 100 |
| GET accounts, cards, institutions, categories, savings-goals, loans, receivables, email sources, pending, email mailboxes, cards/:id/statements, loans/:id/installments | array |
| GET analytics/*, balance-sheet | object |

Sources: sync logs nested `take: 5` (detail 10); nunca tokens. Mailboxes: `{ id, emailAddress, provider, isActive, createdAt, sources[] }`. `POST /sources` exige Gmail ya autorizado + `bankSenderEmail`; 409 si la institución ya tiene vínculo. `GET oauth/google/url` no exige `institutionId`.

## Rutas (resumen)

Ver inventario en código: `*controller.ts` bajo cada capability. Incluye `POST /api/finance/transactions/:id/reverse`, `POST /api/finance/transfers` + `PATCH /api/finance/transfers/:id`, `GET /api/finance/balance-sheet`, `GET /api/finance/cards/:id/statements`, `GET /api/finance/loans/:id` + `/installments`, `POST /api/finance/loans/:id/pay-next-installment`, `POST` + `DELETE /api/finance/savings-goals/:id/contributions[/:contributionId]`, `GET /api/finance/email-sync/mailboxes`, `GET /api/finance/email-sync/oauth/google/url` + `.../callback`.

## Deshacer un borrado

Cada `DELETE` de una entidad de finance guarda un snapshot en `fin_deletion_journal` (`entityType`, `entityId`, `snapshot`) dentro de la misma transacción, y devuelve `undoId`. `POST /api/finance/<entidad>/:id/restore` vuelve a crear las filas, repone los enlaces que la cascada anuló y aplica otra vez el saldo y el gasto del presupuesto que el borrado revirtió. Para una transferencia, `undoId` es el `transferGroupId`.
