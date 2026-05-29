# Finance Module

## Scope

Personal finance domain for:

- Institutions, accounts, and cards (multi-currency)
- Transactions and categories
- Budgets and budget alerts
- Savings goals
- Loans and receivables
- Gmail bank email sync
- Analytics endpoints

## Main Endpoints

- `GET/POST/PATCH/DELETE /finance/institutions`
- `GET/POST/PATCH /finance/accounts`
- `GET/POST/PATCH /finance/cards`
- `POST /finance/cards/:id/balances`
- `GET/POST/PATCH/DELETE /finance/transactions`
- `POST /finance/transactions/:id/confirm`
- `GET/POST/PATCH/DELETE /finance/categories`
- `GET/POST/PATCH/DELETE /finance/budgets`
- `GET/POST/PATCH/DELETE /finance/savings-goals`
- `GET/POST/PATCH /finance/loans`
- `GET/POST/PATCH /finance/receivables`
- `GET/POST/DELETE /finance/email-sync/sources`
- `POST /finance/email-sync/sources/:id/sync`
- `GET /finance/analytics/summary`
- `GET /finance/analytics/spending-by-category`
- `GET /finance/analytics/budget-status`

## Queue Flow

- Queue: `gmail-sync`
- Processor: `GmailSyncProcessor`
- Job payload: `{ userId, sourceId, forceFullSync? }`
- Current implementation is a safe placeholder that writes sync logs and timestamps.

## Security

- New finance tables include RLS policies with ownership checks.
- Logs table uses source ownership policy via `fin_email_sources`.
