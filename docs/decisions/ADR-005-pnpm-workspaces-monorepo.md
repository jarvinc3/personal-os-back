# ADR-005: Monorepo con pnpm workspaces y paquetes compilados

- Estado: `accepted`
- Fecha: 2026-10

## Contexto

Un solo backend NestJS con los módulos dentro de `src/modules` y un solo despliegue. Se quiere separar por proyecto sin cambiar contratos HTTP, base de datos ni despliegue. Ya se usa pnpm y existe `pnpm-workspace.yaml`.

## Decisión

pnpm workspaces con `packages/*`: fase 1 `config`, `database`, `core`, `logos`, `auth`; fase 2 `users`, `finance`, `notifications`, `intelligence`; fase 3 la app a `apps/api`. Cada paquete tiene `package.json`, `tsconfig.json` composite y compila a `dist` con `tsc -b` y project references. La app resuelve `@personal-os/*` desde `node_modules`; Jest mapea a `src` para no exigir build en pruebas. Un solo backend desplegable y un solo esquema Prisma, con dueño `packages/database`.

## Alternativas

Nx: grafo, caché y generadores que hoy no se necesitan y son más caros de quitar. Monorepo de Nest CLI (`apps/` + `libs/`): sin `package.json` por librería. Paquetes como fuente TS: menos ceremonia, pero obliga a tocar `rootDir`/entry de `nest build` y los límites solo los aplica ESLint.

## Consecuencias

Reescritura de imports a `@personal-os/*`. El build exige `pnpm build:packages` antes del app y del lint type-aware; las pruebas no. Los ciclos se rompieron: el guard de idempotencia y el puerto de chat viven en `core`, y `AiCoreModule` es global. Prisma genera en `packages/database/src/generated`. Migración completa: 9 paquetes y la app en `apps/api`.
