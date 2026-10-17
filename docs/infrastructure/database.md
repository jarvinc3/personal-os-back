# Base de datos (Prisma)

- Schema: [`packages/database/prisma/schema.prisma`](../../packages/database/prisma/schema.prisma)
- Client runtime: `packages/database/src/prisma.service.ts` + adapter `pg` (`pg-pool.config.ts`)
- Migraciones: `packages/database/prisma/migrations/`

## Convenciones

- Tablas de dominio finance: prefijo `fin_*`. Core: `users`, `modules`, `user_modules`, `notifications`, `push_tokens`, `ai_*`, outbox.
- PKs: UUID text. Timestamps UTC `created_at` / `updated_at` en entidades mutables.
- Soft-delete típico: `is_active` (instituciones, cuentas, etc.).
- RLS en tablas finance de usuario (Supabase). La fuente ejecutable es el schema/migraciones, no este documento.

## Modelos (inventario)

Users/core: `User`, `Module`, `UserModule`, `AiAgentSession`, `AiMessage`, `AiAction`, `Notification`, `PushToken`, `AuthDeletionOutbox`.

Finance: `FinAccount`, `FinInstitution`, `FinCard`, `FinCardBalance`, `FinTransaction`, `FinCategory`, `FinBudget`, `FinBudgetAlert`, `FinSavingsGoal`, `FinLoan`, `FinReceivable`, `FinEmailConnection`, `FinEmailSource` (`bank_sender_email` opcional; unique `(user_id, institution_id)`), `FinEmailMessage`, `FinEmailSyncLog`, `FinExchangeRate`, `FinRecurringPattern` (reservado, sin API), `DomainEventOutbox`, `ProcessedDomainEvent`.

Enums relevantes: ver `packages/database/prisma/schema.prisma` (`FinTransactionStatus`, `FinEmailMessageOutcome`, etc.).

## Operación

| Comando                                      | Uso                             |
| -------------------------------------------- | ------------------------------- |
| `pnpm db:generate`                           | Client                          |
| `pnpm db:migrate`                            | Dev                             |
| `pnpm db:migrate:deploy`                     | Aplicar pendientes              |
| `pnpm db:migrate:status` / `db:migrate:diff` | Drift                           |
| `pnpm db:validate`                           | Schema                          |
| `pnpm db:encrypt-account-numbers`            | Cifrar cuentas planas (una vez) |

No usar `migrate reset` sobre datos reales.

## Scripts de datos

`pnpm db:encrypt-account-numbers` cifra los `fin_accounts.account_number` que sigan en texto plano con `DATA_ENCRYPTION_KEY` y completa `account_number_last4` / `account_number_hash`. Es idempotente (no recifra lo ya cifrado, solo completa columnas faltantes) y se corre una vez por entorno después de `pnpm db:migrate:deploy`; sin `DATA_ENCRYPTION_KEY` falla al arrancar.

## Migraciones y fechas

El nombre de la carpeta de una migración Prisma (`YYYYMMDDHHMMSS_slug`) es su única clave de orden: Prisma aplica las pendientes en orden lexicográfico. Debe reflejar la fecha real del sistema al crearla; no se adelanta la fecha para forzar el orden.

Hallazgo (2026-10-15):

- Ocho carpetas están fechadas en el futuro respecto a su fecha real de creación: de `20261016090000_ai_session_chat_context` a `20261021100000_subscription_reminder_days_default` (16 al 21 de octubre). Todas se crearon entre el 14 y el 15 de octubre (verificado con `git log --diff-filter=A`).
- `20261015220000_fin_card_charge_categories` y `20261015220000_fix_schema_drift` comparten timestamp. En orden lexicográfico queda primero `fin_card_charge_categories` (`n` < `x`), aunque `fix_schema_drift` se creó antes. Se verificó que no dependen entre sí, así que el orden no altera el resultado.
- Salvo ese par, el orden lexicográfico coincide con el orden de creación y con las dependencias SQL.
- Una migración nueva con la fecha real del sistema (`20261015...`) ordenaría antes que las aplicadas desde `20261015120000` en adelante y que las fechadas del 16 al 21 de octubre. En una base nueva correría antes de migraciones de las que puede depender; en Supabase quedaría fuera de secuencia respecto al historial aplicado.

Estado verificado con `pnpm db:migrate:status` (2026-10-15): 52 migraciones en `packages/database/prisma/migrations`, 51 aplicadas y una pendiente, `20261021100000_subscription_reminder_days_default`.

Decisión: no renombrar migraciones aplicadas. Renombrar cambia el `migration_name` en `_prisma_migrations`; Prisma trataría la carpeta como nueva, intentaría reaplicarla y fallaría o marcaría drift. El riesgo supera el beneficio de alinear las fechas.

Recomendación:

1. No renombrar las 51 migraciones aplicadas.
2. Aplicar la pendiente tal cual: ya ordena al final.
3. Sanear el historial aparte, con respaldo: renombrar las carpetas a su fecha real de creación y actualizar `_prisma_migrations.migration_name` en la misma operación. Es la única vía para tener fechas reales sin romper el orden.
4. Mientras no se sanee, al crear una migración revisar que su carpeta ordene después de la última existente (`20261021100000`); si no, corregir el nombre de la carpeta nueva (aún no aplicada) antes de aplicarla y registrar el ajuste.

Ajuste registrado (2026-10-15): la migración `20261021110000_fin_cash_institution` (pendiente 16) tiene fecha real 2026-10-15 y timestamp corregido a `20261021110000` para ordenar después de `20261021100000`.
