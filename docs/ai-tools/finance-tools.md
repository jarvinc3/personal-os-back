# Finance AI Tools

Available when chat session `moduleSlug` is `finance`. Source: `MODULE_CONTEXT.finance`.

All finance tools delegate to `FinanceService` via `ToolExecutorService`.

## Read-only tools

### `get_finance_summary`

Returns net worth, cash flow, and income/expense totals for a date range.

| Parameter  | Type   | Required | Description    |
| ---------- | ------ | -------- | -------------- |
| `dateFrom` | string | no       | ISO date start |
| `dateTo`   | string | no       | ISO date end   |

**Delegates to:** `FinanceService.getAnalyticsSummary`

---

### `list_transactions`

Lists up to 50 transactions with optional filters.

| Parameter    | Type   | Required | Description                         |
| ------------ | ------ | -------- | ----------------------------------- |
| `accountId`  | string | no       | Filter by account                   |
| `cardId`     | string | no       | Filter by card                      |
| `categoryId` | string | no       | Filter by category                  |
| `type`       | string | no       | `DEBIT`, `CREDIT`, `TRANSFER`       |
| `status`     | string | no       | `PENDING`, `CONFIRMED`, `CANCELLED` |
| `dateFrom`   | string | no       | ISO date start                      |
| `dateTo`     | string | no       | ISO date end                        |
| `search`     | string | no       | Text search on description/merchant |

**Delegates to:** `FinanceService.listTransactions` (page=1, limit=50)

---

### `get_budget_status`

Returns active budgets with spent amount and threshold percentage.

| Parameter | Type | Required |
| --------- | ---- | -------- |
| _(none)_  | —    | —        |

**Delegates to:** `FinanceService.getBudgetStatus`

---

### `list_savings_goals`

Lists all savings goals for the user.

**Delegates to:** `FinanceService.listSavingsGoals`

---

### `list_loans`

Lists active loans with installment progress.

**Delegates to:** `FinanceService.listLoans`

---

### `get_spending_by_category`

Returns spending totals grouped by category.

| Parameter  | Type   | Required |
| ---------- | ------ | -------- |
| `dateFrom` | string | no       |
| `dateTo`   | string | no       |

**Delegates to:** `FinanceService.getSpendingByCategory`

---

## Mutating tools

### `create_transaction`

Creates a manual or agent-initiated transaction.

| Parameter         | Type           | Required | Description                      |
| ----------------- | -------------- | -------- | -------------------------------- |
| `type`            | string         | yes      | `DEBIT`, `CREDIT`, `TRANSFER`    |
| `amount`          | number         | yes      | Transaction amount               |
| `transactionDate` | string         | yes      | ISO date                         |
| `accountId`       | string \| null | no       | Target account                   |
| `cardId`          | string \| null | no       | Target card                      |
| `currency`        | string         | no       | ISO 4217 (defaults from account) |
| `description`     | string \| null | no       | Free text                        |
| `merchant`        | string \| null | no       | Merchant name                    |
| `categoryId`      | string \| null | no       | Category UUID                    |

**Delegates to:** `FinanceService.createTransaction`

---

### `create_or_update_budget`

Creates a new budget or updates an existing one when `budgetId` is provided.

| Parameter           | Type           | Required | Description                     |
| ------------------- | -------------- | -------- | ------------------------------- |
| `categoryId`        | string         | yes      | Budget category                 |
| `periodType`        | string         | yes      | `MONTHLY`, `BIWEEKLY`, `CUSTOM` |
| `periodStart`       | string         | yes      | Period start date               |
| `periodEnd`         | string         | yes      | Period end date                 |
| `amountLimit`       | number         | yes      | Budget cap                      |
| `budgetId`          | string \| null | no       | Existing budget to update       |
| `alertThresholdPct` | number \| null | no       | Alert at % of limit             |

**Delegates to:** `FinanceService.createBudget` or `FinanceService.updateBudget`

---

### `create_savings_goal`

Creates a savings goal.

| Parameter       | Type           | Required |
| --------------- | -------------- | -------- |
| `name`          | string         | yes      |
| `targetAmount`  | number         | yes      |
| `currentAmount` | number \| null | no       |
| `currency`      | string \| null | no       |
| `targetDate`    | string \| null | no       |

**Delegates to:** `FinanceService.createSavingsGoal`

---

### `update_savings_goal`

Updates progress or metadata on an existing goal.

| Parameter       | Type           | Required |
| --------------- | -------------- | -------- |
| `goalId`        | string         | yes      |
| `currentAmount` | number \| null | no       |
| `targetAmount`  | number \| null | no       |
| `name`          | string \| null | no       |

**Delegates to:** `FinanceService.updateSavingsGoal`

---

### `mark_loan_installment_paid`

Increments `paidInstallments` and decrements `currentBalance` by one installment amount.

| Parameter | Type   | Required |
| --------- | ------ | -------- |
| `loanId`  | string | yes      |

**Delegates to:** `FinanceService.updateLoan` (derived patch from current loan state)

---

### `trigger_email_sync`

Enqueues a Gmail sync job for one email source.

| Parameter  | Type   | Required |
| ---------- | ------ | -------- |
| `sourceId` | string | yes      |

**Delegates to:** `FinanceService.triggerEmailSync` → BullMQ queue `gmail-sync`

**Note:** Current processor is a placeholder; it updates sync logs and timestamps without parsing emails yet.

---

## Context inclusion

Finance context always includes `get_user_context` plus all tools above. Finance module config cannot be changed via `update_module_config` (blocked in executor).

## Related

- REST API: `docs/modules/finance.md`
- Queue: `GmailSyncProcessor` in `src/modules/finance/gmail-sync.processor.ts`
