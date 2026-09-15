# Finance — HTTP

Base: `/api/finance`. Auth: Bearer + `@RequiresEnabledModule('finance')` salvo callback OAuth `@Public()`.

Envelope `{ data, meta }`.

## Controllers

| Área | Controllers |
| --- | --- |
| Ledger | `TransactionsController`, `TransfersController` |
| Catalog | Institutions, Accounts, Cards, Categories |
| Planning | Budgets, Savings, Loans, Receivables |
| Analytics | `AnalyticsController` |
| Balance sheet | `BalanceSheetController` |
| FX | `CurrenciesController` |
| Ingestion | `EmailSyncController` |

## List shapes (`data`)

| Endpoint | Shape |
| --- | --- |
| GET transactions, budgets | `{ items, pagination }` default 1/20 max 100 |
| GET accounts, cards, institutions, categories, savings-goals, loans, receivables, email sources, pending | array |
| GET analytics/*, balance-sheet | object |

Sources: sync logs nested `take: 5` (detail 10); nunca tokens.

## Rutas (resumen)

Ver inventario en código: `*controller.ts` bajo cada capability. Incluye `POST /api/finance/transactions/:id/reverse`, `POST /api/finance/transfers`, `GET /api/finance/balance-sheet`, `GET /api/finance/email-sync/oauth/google/url` + `.../callback`.
