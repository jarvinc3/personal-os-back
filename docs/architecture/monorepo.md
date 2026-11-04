# Monorepo (pnpm workspaces)

Un solo backend desplegable. Los módulos viven como paquetes del workspace y la app Nest los consume por `@personal-os/*`.

## Layout

- `packages/*`: 10 paquetes con `package.json` propio y build a `dist/` (`tsc -b` + project references).
- `apps/api/src`: app Nest (`main.ts`, `app.module.ts`, `health/`); `nest build` compila a `dist/`.
- `packages/database/prisma/`: schema, migraciones y `prisma.config.ts`; el cliente se genera en `packages/database/src/generated/`.

## Paquetes

| Paquete                      | Contenido                                                                                    | Depende de                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `@personal-os/config`        | env Zod, límites de IA                                                                       | —                                                                |
| `@personal-os/contracts`     | interfaces y tokens neutrales de inferencia, capacidades, settings, intents y eventos        | —                                                                |
| `@personal-os/database`      | PrismaService, cliente generado, pool pg                                                     | config                                                           |
| `@personal-os/core`          | guards, filters, eventos, colas y paginación                                                 | config, database                                                 |
| `@personal-os/logos`         | LogoService y dominio                                                                        | config, core                                                     |
| `@personal-os/auth`          | Supabase JWT, admin y estrategia                                                             | config, core                                                     |
| `@personal-os/users`         | usuarios, módulos y preferencias                                                             | auth, core, database                                             |
| `@personal-os/finance`       | ledger, ingesta, catálogo, planeación, analytics                                             | config, contracts, core, database, logos, users                  |
| `@personal-os/notifications` | push, websockets y correo                                                                    | auth, config, core, database, finance, users                     |
| `@personal-os/intelligence`  | inferencia, conversaciones, capacidades, acciones, correo, evidencia, conocimiento y señales | config, contracts, core, database, finance, notifications, users |

## Build y pruebas

- `pnpm build:packages` compila en orden topológico; `pnpm build` lo ejecuta y después `nest build` (app en `apps/api`).
- `pnpm test` corre Jest desde la raíz con mapper `@personal-os/*` → `packages/*/src`; probar no exige build.
- El lint type-aware necesita los paquetes compilados (`pnpm build:packages`); CI lo hace tras `prisma generate`.
- Añadir un paquete: `package.json` (`main`/`types` a `dist`), `tsconfig.json` composite con `references`, barrel `src/index.ts` y dependencia `workspace:*` en quien lo use.

## Paquetes, no apps

Los módulos son paquetes porque el objetivo es un solo backend desplegable: un proceso Nest, un despliegue y una base. Una app por módulo agregaría contratos de red, varios pipelines y decidir base compartida o separada, sin una necesidad actual. Si un módulo necesita escalar aparte (por ejemplo el worker de IA), se extrae ese proceso a `apps/<nombre>` consumiendo la misma cola, sin deshacer los paquetes.

## Reglas

- Un paquete importa a otro solo por su barrel, nunca por carpetas internas; ESLint y `tsc -b` lo verifican.
- El esquema Prisma es único y su dueño es `packages/database`.
- El guard de idempotencia vive en `core`. El puerto `INFERENCE_COMPLETION` vive
  en `contracts`; `AiCoreModule` lo conecta con el pool de inferencia como módulo
  global. Finance usa el puerto sin importar AI.
- La app vive en `apps/api`; `pnpm start:dev` compila paquetes y levanta el watch de Nest.
