# CI

Workflow: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). Corre en push a `develop` y `master`, en pull requests con `pull_request_target` y a mano con `workflow_dispatch`.

Los jobs corren en los runners self-hosted de Windows de la PC de casa (`[self-hosted, personal-os]`) con `pwsh`: `changes`, `checks` y `backend`. El runner es dedicado: conserva `node_modules` entre corridas y usa el store de pnpm de la máquina (`$env:LOCALAPPDATA\pnpm\store`).

Pipeline: audit producción (no bloqueante) → Prisma validate → Prisma generate → build de paquetes → lint → format:check → money guard → build → unit. El job `backend` levanta un Postgres de Docker con puerto dinámico, aplica `pnpm db:migrate:deploy`, comprueba que no haya drift (`pnpm db:migrate:diff:check`) y corre e2e e integración.

## Pull requests y forks

- Los PRs usan `pull_request`: el workflow corre con el merge del PR, así que un cambio al CI se valida en el mismo PR.
- El repositorio es privado y GitHub no ofrece la aprobación de PRs de fork en repos privados; la política de forks queda fuera de este runbook.
- Un push a `develop` o `master`, y una corrida manual (`workflow_dispatch`), usan el commit de la rama.
