# Finance — estado

Fecha: 2026-10-14 (v0.25.2)

| Ítem                                                 | Estado                  | Evidencia                                                                                                                             |
| ---------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog / ledger / planning / analytics / FX / Gmail | `implemented`           | capabilities + e2e `test/finance.e2e-spec.ts`                                                                                         |
| Edición de transferencia (`PATCH /transfers/:id`)    | `implemented`           | `ledger/application/update-transfer.use-case.ts` + spec                                                                               |
| Validación cruzada de préstamos en el DTO            | `implemented`           | `planning/presentation/dto/loan-fields.dto.ts` + `create-loan.dto.spec.ts`                                                            |
| Aporte a meta ligado a una cuenta                    | `implemented`           | `planning/application/record-savings-goal-contribution.use-case.ts`; migración `20261013120000_fin_savings_goal_contribution_account` |
| Deshacer un borrado                                  | `implemented`           | `fin_deletion_journal` + `shared/infrastructure/deletion-journal.repository.ts`; endpoints `<entidad>/:id/restore`                    |
| Listado de archivados y borrados                     | `implemented`           | `shared/recycle-bin.module.ts`; `GET /api/finance/recycle-bin`                                                                        |
| Estados de cuenta de tarjeta                         | `implemented`           | `statements/`; job diario `CardStatementsScheduler`                                                                                   |
| Import de estado de cuenta (PDF) y conciliación      | `implemented`           | `statements/`; endpoints `statement-imports`; migración `20261015230000_fin_statement_imports`; e2e upload → apply                    |
| Outbox versionado                                    | `implemented`           | `events/`                                                                                                                             |
| Comercios canónicos (`FinMerchant`, normalizador, merge, logo) | `implemented` | `merchants/`; `GET/PATCH /finance/merchants`, `GET /merchants/suggest`, `POST /merchants/:id/merge`, `POST /merchants/:id/logo` (v0.25.x) |
| Recurrentes: detección, confirmación y alertas | `implemented` | `recurring/`; `GET/POST /finance/recurring`, `GET /recurring/upcoming`, `PATCH /recurring/:id`; `recurring-alerts.service.ts` emite `FINANCE_RECURRING_PRICE_CHANGED`/`MISSED`/`UPCOMING` (v0.25.x) |
| Captura rápida (texto → borrador de movimiento) | `implemented` | `quick-entry/`; `POST /finance/quick-entry/parse` (v0.24.x) |
| Resumen semanal | `implemented` | `analytics/application/weekly-summary.service.ts`, `weekly-summary.scheduler.ts`; `GET /finance/analytics/weekly-summary` (v0.24.x) |
| Paginación por cursor uniforme | `implemented` | ADR-006; listas que crecen devuelven `{items, nextCursor, hasMore}` (v0.22.x) |
| Suscripciones gestionadas (tablas, pagos, recordatorios) | `planned` | pendiente 08 (web `docs/modules/finance/pendientes/08-suscripciones.md`) |
| `finance.email_sync.failed` emit                     | `planned`               | constante sin emit — REV-BACK-003                                                                                                     |
| HTTP smoke script                                    | `blocked`               | archivo ausente — REV-BACK-005                                                                                                        |
| AI `reverseTransaction` tool                         | `planned`               | façade tiene método; no hay tool — rest-vs-facade                                                                                     |
