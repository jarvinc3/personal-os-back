# Scripts

Fuente: `package.json`.

| Comando                                 | Descripción                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm start:dev`                        | Hot reload                                                                           |
| `pnpm build` / `pnpm start:prod`        | Compilar / producción                                                                |
| `pnpm lint`                             | ESLint (incluye `no-restricted-imports` de barrels)                                  |
| `pnpm test`                             | Unit (Jest, `src/**/*.spec.ts`)                                                      |
| `pnpm test:e2e`                         | E2E: health, auth, users, notifications, finance, ai-agent                           |
| `pnpm db:migrate`                       | Migraciones Prisma (dev)                                                             |
| `pnpm db:migrate:status`                | Estado                                                                               |
| `pnpm db:migrate:deploy`                | Aplicar pendientes                                                                   |
| `pnpm db:migrate:diff`                  | Drift schema vs datasource                                                           |
| `pnpm db:migrate:resolve:applied`       | Marcar migración aplicada                                                            |
| `pnpm db:validate` / `pnpm db:generate` | Validar / generar client                                                             |
| `pnpm db:studio`                        | Prisma Studio                                                                        |
| `pnpm db:seed`                          | Seed                                                                                 |
| `pnpm smoke:finance`                    | Smoke HTTP de endpoints clave contra `SMOKE_BASE_URL`                                |
| `pnpm sentry:sourcemaps`                | Sube los source maps de `dist` si existe `SENTRY_AUTH_TOKEN`; sin token no hace nada |

Migración `20260904180000_finance_ownership_email_connections`: expand/backfill/contract de `fin_email_connections`, deriva `institution_id`, aborta con ids irresolubles. Siguiente `20260904210000_account_card_email_message_fk` quita `last_four` de cuentas y deja FK `email_message_id` → `fin_email_messages.id`. Revisar SQL y `pnpm db:migrate:diff` antes de staging.
