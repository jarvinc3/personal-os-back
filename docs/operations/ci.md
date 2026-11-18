# CI

Workflow: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). Corre en push a `develop` y `master`, en pull requests con `pull_request_target` y a mano con `workflow_dispatch`.

Los jobs corren en los runners self-hosted de Windows de la PC de casa (`[self-hosted, personal-os]`) con `pwsh`: `changes`, `checks` y `backend`. El runner es dedicado: conserva `node_modules` entre corridas y usa el store de pnpm de la máquina (`$env:LOCALAPPDATA\pnpm\store`).

Pipeline: audit producción (no bloqueante) → Prisma validate → Prisma generate → build de paquetes → lint → format:check → money guard → build → unit. El job `backend` levanta un Postgres de Docker con puerto dinámico, aplica `pnpm db:migrate:deploy`, comprueba que no haya drift (`pnpm db:migrate:diff:check`) y corre e2e e integración.

## Pull requests y forks

- Los PRs usan `pull_request_target`: el workflow que corre es el de la rama base, así que un PR no puede quitar ni cambiar la guarda de fork.
- Solo los PRs del mismo repositorio (`github.event.pull_request.head.repo.full_name == github.repository`) hacen checkout del head (`github.event.pull_request.head.sha`) y se ejecutan en el runner. Un PR de fork deja todos los jobs en `skipped` y no toca la PC.
- Un push a `develop` o `master`, y una corrida manual (`workflow_dispatch`), usan el commit de la rama.
- El CI de un PR del mismo repositorio no valida cambios al propio workflow: esos se validan con `workflow_dispatch` sobre la rama y con el push a `develop` después del merge.
