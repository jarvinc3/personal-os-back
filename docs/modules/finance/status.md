# Finance — estado

Fecha: 2026-10-12

| Ítem | Estado | Evidencia |
| --- | --- | --- |
| Catalog / ledger / planning / analytics / FX / Gmail | `implemented` | capabilities + e2e `test/finance.e2e-spec.ts` |
| Edición de transferencia (`PATCH /transfers/:id`) | `implemented` | `ledger/application/update-transfer.use-case.ts` + spec |
| Validación cruzada de préstamos en el DTO | `implemented` | `planning/presentation/dto/loan-fields.dto.ts` + `create-loan.dto.spec.ts` |
| Aporte a meta ligado a una cuenta | `implemented` | `planning/application/record-savings-goal-contribution.use-case.ts`; migración `20261013120000_fin_savings_goal_contribution_account` |
| Estados de cuenta de tarjeta | `implemented` | `statements/`; job diario `CardStatementsScheduler` |
| Outbox versionado | `implemented` | `events/` |
| Recurring patterns API | `planned` (schema only) | modelo Prisma, sin controller |
| `finance.email_sync.failed` emit | `planned` | constante sin emit — REV-BACK-003 |
| HTTP smoke script | `blocked` | archivo ausente — REV-BACK-005 |
| AI `reverseTransaction` tool | `planned` | façade tiene método; no hay tool — rest-vs-facade |
