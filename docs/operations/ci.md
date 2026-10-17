# CI

Workflow: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). Corre en push y pull request a `develop`.

Pipeline: audit producción (no bloqueante) → Prisma validate → Prisma generate → build de paquetes → `pnpm db:migrate:deploy` contra un Postgres de servicio → drift check (`pnpm db:migrate:diff:check`) → lint → format:check → money guard (`pnpm lint:money`) → build → unit → e2e.
