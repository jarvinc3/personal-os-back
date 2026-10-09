# Finance — estado

Fecha: 2026-09-16

| Ítem | Estado | Evidencia |
| --- | --- | --- |
| Catalog / ledger / planning / analytics / FX / Gmail | `implemented` | capabilities + e2e `test/finance.e2e-spec.ts` |
| Estados de cuenta de tarjeta | `implemented` | `statements/`; job diario `CardStatementsScheduler` |
| Outbox versionado | `implemented` | `events/` |
| Recurring patterns API | `planned` (schema only) | modelo Prisma, sin controller |
| `finance.email_sync.failed` emit | `planned` | constante sin emit — REV-BACK-003 |
| HTTP smoke script | `blocked` | archivo ausente — REV-BACK-005 |
| AI `reverseTransaction` tool | `planned` | façade tiene método; no hay tool — rest-vs-facade |
