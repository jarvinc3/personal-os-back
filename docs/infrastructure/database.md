# Base de datos (Prisma)

- Schema: [`prisma/schema.prisma`](../../prisma/schema.prisma)
- Client runtime: `src/prisma/prisma.service.ts` + adapter `pg` (`pg-pool.config.ts`)
- Migraciones: `prisma/migrations/`

## Convenciones

- Tablas de dominio finance: prefijo `fin_*`. Core: `users`, `modules`, `user_modules`, `notifications`, `push_tokens`, `ai_*`, outbox.
- PKs: UUID text. Timestamps UTC `created_at` / `updated_at` en entidades mutables.
- Soft-delete típico: `is_active` (instituciones, cuentas, etc.).
- RLS en tablas finance de usuario (Supabase). La fuente ejecutable es el schema/migraciones, no este documento.

## Modelos (inventario)

Users/core: `User`, `Module`, `UserModule`, `AiAgentSession`, `AiMessage`, `AiAction`, `Notification`, `PushToken`, `AuthDeletionOutbox`.

Finance: `FinAccount`, `FinInstitution`, `FinCard`, `FinCardBalance`, `FinTransaction`, `FinCategory`, `FinBudget`, `FinBudgetAlert`, `FinSavingsGoal`, `FinLoan`, `FinReceivable`, `FinEmailConnection`, `FinEmailSource` (`bank_sender_email` opcional; unique `(user_id, institution_id)`), `FinEmailMessage`, `FinEmailSyncLog`, `FinExchangeRate`, `FinRecurringPattern` (reservado, sin API), `DomainEventOutbox`, `ProcessedDomainEvent`.

Enums relevantes: ver `prisma/schema.prisma` (`FinTransactionStatus`, `FinEmailMessageOutcome`, etc.).

## Operación

| Comando | Uso |
| --- | --- |
| `pnpm db:generate` | Client |
| `pnpm db:migrate` | Dev |
| `pnpm db:migrate:deploy` | Aplicar pendientes |
| `pnpm db:migrate:status` / `db:migrate:diff` | Drift |
| `pnpm db:validate` | Schema |

No usar `migrate reset` sobre datos reales.

> [!WARNING]
> **REV-BACK-005** (`NO_IMPLEMENTADO`) — `pnpm db:reconcile-balances` apunta a `prisma/scripts/reconcile-balances.ts`, directorio inexistente. Igual el smoke `prisma/scripts/smoke-finance-http.ts` citado en docs antiguas. [review-register.md](../review-register.md#rev-back-005)
