# CI

Workflow: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). Corre en push a `develop` y `master`, en pull requests con `pull_request` y a mano con `workflow_dispatch`.

Los jobs `changes`, `checks` y `backend` corren en los runners de GitHub (`ubuntu-latest`) con bash. El repo es público, así que esos runners no consumen minutos. Cada job instala con `pnpm install --frozen-lockfile` y la caché de pnpm de `actions/setup-node`. El job `backend` usa un service container `postgres:16-alpine` en `localhost:5432`.

Un push nuevo a un PR cancela la corrida anterior del mismo PR; los push a `develop` y `master` no se cancelan.

Pipeline: audit producción (bloquea en `high`) → Prisma validate → Prisma generate → build de paquetes → lint → format:check → money guard → build → unit. El job `backend` usa el Postgres del service container, crea los roles stub de Supabase, aplica `pnpm db:migrate:deploy`, comprueba que no haya drift (`pnpm db:migrate:diff:check`) y corre e2e e integración.

## Pull requests y forks

- Los PRs usan `pull_request`: el workflow corre con el merge del PR, así que un cambio al CI se valida en el mismo PR.
- El repositorio es público. Un PR desde un fork de alguien que no es colaborador necesita que el owner apruebe la corrida (Settings → Actions → «Require approval for all external contributors»). El `GITHUB_TOKEN` por defecto es de solo lectura.
- Un push a `develop` o `master`, y una corrida manual (`workflow_dispatch`), usan el commit de la rama.
