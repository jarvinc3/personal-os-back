# REST vs FinanceFacade

Chat tools llaman **solo** `FinanceFacade`. REST es más amplio. No tratar el catálogo de tools como superficie HTTP.

| Capability                         | REST                 | Facade / tools                                          |
| ---------------------------------- | -------------------- | ------------------------------------------------------- |
| Create loan                        | `POST /loans`        | No (`listLoans` + `updateLoan`)                         |
| Receivables                        | list/create/PATCH    | No                                                      |
| Institutions/accounts/cards writes | Sí                   | Lists only                                              |
| Categories writes                  | Sí                   | `listCategories` only                                   |
| Delete transaction                 | `DELETE`             | No                                                      |
| Reverse                            | `POST .../reverse`   | Facade `reverseTransaction`; tool `reverse_transaction` |
| Gmail OAuth URL + public callback  | Sí                   | No (`listEmailSources` + `triggerEmailSync`)            |
| Pending assign/retry               | Sí                   | No                                                      |
| Budgets list                       | paginado             | Unbounded `listBudgets`                                 |
| Balance sheet                      | `GET /balance-sheet` | Indirecto via `getAnalyticsSummary`                     |

Tools: [finance-tools.md](./finance-tools.md). Facade: `packages/finance/src/finance.facade.ts`.
