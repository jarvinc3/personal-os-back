# Capacidad: planning

- Budgets: por categoría y periodo (`MONTHLY`/`BIWEEKLY`/`CUSTOM`). `GET` paginado. `amountLimit`/`amountSpent` strings; `alertThresholdPct` number. Facade `listBudgets` es array unbounded (AI).
- Savings: `isCompleted` recalculado al cambiar amounts.
- Loans: archivo `PATCH isActive` / `DELETE`. `institutionId` opcional + `lenderName`. `accountId` = cuenta de pago (misma institución si lender catalogado). `interestRate` fracción 0–1 `Decimal(5,4)` (`0.12` = 12%; `null` ≠ `0`).
- Receivables: `GET/POST/PATCH`, **sin DELETE**. Status `PENDING`\|`PARTIAL`\|`PAID`\|`CANCELLED`. `paidAmount` ∈ [0, amount]; `PAID` exige `paidAmount=amount` (omitido se completa); omitir status deriva de amounts; `CANCELLED` no exige pago completo.

Evidencia: `planning/application/planning.service.ts` + specs.
