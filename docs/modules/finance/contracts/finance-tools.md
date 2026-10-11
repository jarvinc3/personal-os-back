# Finance AI Tools

Available when chat session `moduleSlug` is `finance`. Source: `MODULE_CONTEXT.finance`.

All finance tools delegate to **`FinanceFacade`** via `ToolExecutorService`. They also require `user_modules.finance.isEnabled`; otherwise the tool returns `success: false` with `Tool execution failed: Finance module is disabled`.

Tools are **not** the full REST surface. There is no tool (and in several cases no facade method) for create loan, receivables, institution/account/card writes, hard-delete of a transaction, or Gmail OAuth. See [REST vs façade](./rest-vs-facade.md).

## Read-only tools

### `get_finance_summary`

Returns cash flow and income/expense totals for a date range, plus the current position from the balance sheet. Money fields in the payload are decimal **strings** (`cashFlow`, `totals.income`, `totals.expenses`, `totals.accountBalance`). Position fields (`netWorth`, `totals.cardDebt`) are strings when `balanceStatus` is `COMPLETE`, or `null` when `INCOMPLETE` (for example a credit card without `creditLimit`). `balanceIssues` lists the missing data.

| Parameter  | Type   | Required | Description    |
| ---------- | ------ | -------- | -------------- |
| `dateFrom` | string | no       | ISO date start |
| `dateTo`   | string | no       | ISO date end   |

**Delegates to:** `FinanceFacade.getAnalyticsSummary`

---

### `list_transactions`

Lists up to 50 transactions with optional filters.

| Parameter    | Type   | Required | Description                                                 |
| ------------ | ------ | -------- | ----------------------------------------------------------- |
| `accountId`  | string | no       | Filter by account                                           |
| `cardId`     | string | no       | Filter by card                                              |
| `categoryId` | string | no       | Filter by category (UUID)                                   |
| `type`       | string | no       | `DEBIT`, `CREDIT`, `TRANSFER`                               |
| `status`     | string | no       | `PENDING`, `CONFIRMED`, `DECLINED`, `CANCELLED`, `REVERSED` |
| `dateFrom`   | string | no       | ISO date start                                              |
| `dateTo`     | string | no       | ISO date end                                                |
| `search`     | string | no       | Text search on description/merchant                         |

**Delegates to:** `FinanceFacade.listTransactions` (limit=50)

---

### `get_transaction`

Returns one transaction by id.

| Parameter       | Type   | Required |
| --------------- | ------ | -------- |
| `transactionId` | string | yes      |

**Delegates to:** `FinanceFacade.getTransaction`

---

### `list_categories`

Lists finance categories for the user (system + custom). Optional `type`: `EXPENSE` | `INCOME`. Each item includes `type`.

**Delegates to:** `FinanceFacade.listCategories`

---

### `list_accounts`

Lists finance accounts.

**Delegates to:** `FinanceFacade.listAccounts`

---

### `list_cards`

Lists credit/debit cards and multi-currency balances.

**Delegates to:** `FinanceFacade.listCards`

---

### `list_budgets`

Lists budget periods for the user.

**Delegates to:** `FinanceFacade.listBudgets`

---

### `list_email_sources`

Lists connected Gmail email sources (for sync targeting).

**Delegates to:** `FinanceFacade.listEmailSources`

---

### `get_budget_status`

Returns active budgets with spent amount and threshold percentage.

**Delegates to:** `FinanceFacade.getBudgetStatus`

---

### `list_savings_goals`

**Delegates to:** `FinanceFacade.listSavingsGoals`

---

### `list_loans`

**Delegates to:** `FinanceFacade.listLoans`

---

### `get_spending_by_category`

| Parameter  | Type   | Required |
| ---------- | ------ | -------- |
| `dateFrom` | string | no       |
| `dateTo`   | string | no       |

**Delegates to:** `FinanceFacade.getSpendingByCategory`

Each item is `{ categoryId, name, color, icon, total }`. `categoryId` may be null (`name` = `Sin categoría`). `total` is a decimal string: the sum of `amountBaseCurrency` for DEBIT + CONFIRMED in the range. Deleted categories keep the total and use `Categoría no disponible`.

---

### `get_spending_over_time`

| Parameter  | Type   | Required | Description                         |
| ---------- | ------ | -------- | ----------------------------------- |
| `dateFrom` | string | no       | ISO start                           |
| `dateTo`   | string | no       | ISO end                             |
| `groupBy`  | string | no       | `day` (default), `week`, or `month` |

**Delegates to:** `FinanceFacade.getSpendingOverTime`

---

## Mutating tools

Mutating args are validated with Zod (`tool-arg-schemas.ts`).

### `create_transaction`

Creates a transaction with **`source=AI`**.

| Parameter         | Type           | Required    | Description                        |
| ----------------- | -------------- | ----------- | ---------------------------------- |
| `type`            | string         | yes         | `DEBIT` or `CREDIT` (not TRANSFER) |
| `amount`          | number         | yes         | Transaction amount                 |
| `transactionDate` | string         | yes         | ISO date                           |
| `accountId`       | string \| null | exactly one | Target account (XOR with cardId)   |
| `cardId`          | string \| null | exactly one | Target card (XOR with accountId)   |
| `currency`        | string         | no          | ISO 4217                           |
| `description`     | string \| null | no          | Free text                          |
| `merchant`        | string \| null | no          | Merchant name                      |
| `categoryId`      | string \| null | no          | Category UUID                      |

**Delegates to:** `FinanceFacade.createTransaction` (source forced to `AI`)

---

### `create_transfer`

Moves amount from an account to one ledger target (exactly one of account/card as destination). A card is never the origin.

**Delegates to:** `FinanceFacade.createTransferTransaction`

---

### `update_transaction`

Updates **metadata only** (`categoryId`, `merchant`, `description`, `notes`). Amount/currency/status/date are not part of the AI tool schema.

**Delegates to:** `FinanceFacade.updateTransaction`

---

### `confirm_transaction`

Confirms a `PENDING` transaction (applies ledger).

**Delegates to:** `FinanceFacade.confirmTransaction`

---

### `create_or_update_budget`

Creates a new budget or updates when `budgetId` is provided.

**Delegates to:** `FinanceFacade.createBudget` / `updateBudget`

---

### `create_savings_goal` / `update_savings_goal`

**Delegates to:** `FinanceFacade.createSavingsGoal` / `updateSavingsGoal`

---

### `mark_loan_installment_paid`

Increments `paidInstallments` and decrements `currentBalance` by one installment.

---

### `trigger_email_sync`

Triggers Gmail sync for one email source. Returns `queued: true|false` — do not claim success if `queued` is false.

**Worker:** `ingestion/infrastructure/gmail-sync.processor.ts` (AI extraction, not HTML parsers).

---

## Related

- REST: [http.md](./http.md)
- Façade: [rest-vs-facade.md](./rest-vs-facade.md) · `packages/finance/src/finance.facade.ts`
