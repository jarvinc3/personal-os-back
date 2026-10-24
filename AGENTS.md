# AGENTS.md — personal-os-back

Instrucciones para agentes y reviewers que trabajan en el backend de Personal OS.

## Orden de lectura

1. Este archivo.
2. [docs/README.md](docs/README.md) — mapa del repositorio.
3. [docs/documentation-standard.md](docs/documentation-standard.md) — taxonomía, IDs, anti-duplicación.
4. El módulo o área que vas a tocar bajo `docs/modules/` o `docs/infrastructure/`.
5. Código y pruebas citados en esos documentos. No inferir desde nombres.
6. [docs/reference/changelog-guide.md](docs/reference/changelog-guide.md) — antes de cerrar la sesión, para el CHANGELOG y la versión.
   - [docs/versionado.md](docs/versionado.md) - política de versionado beta `0.x` (obligatoria; manda sobre la guía del changelog).

Si una afirmación no está `VERIFICADO`, no la trates como comportamiento vigente: compruébala en código o abre un issue.

## Seguimiento con GitHub Issues

El estado, el roadmap y los hallazgos viven en GitHub Issues. Los documentos de trabajo cerrados pasan a [docs/archive/](docs/archive/).

- Un cambio resuelve un issue: el cuerpo del commit cierra con `Closes #N` cuando el issue queda resuelto, o `Refs #N` cuando solo avanza.
- Lo decidido y no implementado se abre como issue con label `roadmap`; no se deja como `REV-*` suelto en los documentos.
- Cómo se escribe un issue: [docs/issue-conventions.md](docs/issue-conventions.md) — estructura, título, criterios de aceptación, etiquetas, talla y cierre.

## Fuentes canónicas

| Tema                                             | Dónde                                                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Dominio, REST, Prisma, eventos, colas, seguridad | este repositorio (`docs/` + `src/` + `packages/`)                                                                |
| UI, rutas Next.js, Web Push del navegador        | `personal-os-web`                                                                                                |
| Envelope HTTP `{ data, meta }`                   | `packages/core/src/interceptors/transform.interceptor.ts`                                                        |
| Eventos                                          | `packages/core/src/events/event.constants.ts`                                                                    |
| Env                                              | `packages/config/src/env.schema.ts`                                                                              |
| App (interfaz) vs módulo (código)                | [docs/glosario.md](docs/glosario.md) · regla `.cursor/rules/module-terminology.mdc`                              |
| Tools IA                                         | `packages/ai-agent/src/tools/tool.registry.ts` + `prompts/module-context.ts`                                     |
| API pública entre módulos Nest                   | `packages/<nombre>/src/index.ts` y barrels `@personal-os/<nombre>` (regla `.cursor/rules/module-public-api.mdc`) |
| Prefijo de versión de la API                     | [ADR-007](docs/decisions/ADR-007-sin-prefijo-de-version.md) — sin `/v1`                                          |

## Changelog y versión

### Excepción acordada: reset de arquitectura 0.100.0

Esta excepción se activa solo al iniciar AI-0, después de verificar el corte
estable de PROD (base prevista 0.55.1 más hotfixes previos aprobados). Antes de
AI-0, correcciones independientes como el outbox siguen con su PATCH normal.
Durante el reset, back y web mantienen `0.100.0` y acumulan cambios bajo
`Unreleased — 0.100.0`: no hay bump, release ni tag por sesión. El owner decide
el deploy tras AI-11; AI-12 queda para `0.101.0`. Merges y deploys no se ejecutan
como consecuencia de esta excepción.

Lectura obligatoria antes de AI/email:
[roadmap](docs/refactors/00-MASTER-ROADMAP.md),
[decisiones](docs/refactors/01-IMPLEMENTATION-DECISIONS.md) e
[inventario](docs/refactors/02-PHASE-0-INVENTORY.md).

Toda sesión de agente cierra con un release: `CHANGELOG.md` actualizado y `version` de `package.json` subida. Antes de escribirlo, lee [docs/reference/changelog-guide.md](docs/reference/changelog-guide.md) completo; ahí están las reglas, las secciones y un ejemplo.

La versión sigue **estrictamente** [docs/versionado.md](docs/versionado.md): beta `0.MINOR.PATCH`, nunca bajar de versión, `1.0.0` solo cuando el usuario lo decida y los hitos de módulo como nombre de release.

- Un release por sesión, aunque el cambio sea pequeño. El bump es el más alto de la sesión: `MAJOR` si rompe un contrato o los datos guardados, `MINOR` si agrega un endpoint o un dato nuevo y `PATCH` en el resto.
- Una sola versión para el monorepo: el `package.json` de la raíz. Los paquetes de `packages/*` no se publican por separado.
- El CHANGELOG va en español, de la versión más nueva a la más vieja, con la fecha en `AAAA-MM-DD`.
- Cierra con `chore(release): vX.Y.Z` y crea el tag `vX.Y.Z`.
- La documentación también pasa prettier: `pnpm format:check` cubre `ts`, `tsx` y `md`.
- `personal-os-app` está fuera de servicio y no sigue esta regla.

## Fechas

Usa siempre la fecha real del sistema (`date`) para changelogs y documentos. No adelantes la fecha para "ordenar" artefactos. En migraciones Prisma manda la sección siguiente.

## Migraciones Prisma

Una migración aplicada no se toca. Prisma la identifica por el nombre de su carpeta en `_prisma_migrations`: renombrarla la vuelve una migración nueva y editar su SQL cambia el checksum. En ambos casos el historial queda roto.

- Antes de nombrar una migración, inspeccionar la última carpeta existente. Si la fecha real no ordena después, usar el siguiente timestamp libre y registrar la fecha real en el SQL. No confiar en un timestamp fijo de este documento.
- El timestamp duplicado `20261015220000` (`fin_card_charge_categories` y `fix_schema_drift`) se queda tal cual.
- Nunca aceptar el reset que ofrece `prisma migrate dev`: el checksum de `20261022000000` cambió en dev.
- Prod recibe las migraciones vía Railway con `pnpm db:migrate:deploy`.

Detalle en [docs/infrastructure/database.md](docs/infrastructure/database.md#migraciones-y-fechas).

Excepción única de AI-0: se permite reemplazar el historial por una baseline en
repo/DEV tras inspeccionar PROD `_prisma_migrations` de solo lectura, comprobar
el SQL preservado y preparar backup/rebuild DEV. Fuera de ese paso se mantienen
las reglas anteriores. Los agentes nunca aplican migraciones ni resets a PROD.

## Checklist al cambiar comportamiento

- [ ] Correr `pnpm lint`, `pnpm test` y `pnpm test:e2e` (obligatorio en todo cambio).
- [ ] Correr `pnpm format:check`; un archivo sin formato o un test en rojo bloquea el cierre.
- [ ] Actualizar el documento dueño (capacidad, regla o contrato), no un README monolítico.
- [ ] Si el cambio no se puede verificar, abre un issue con el detalle.
- [ ] Imports cruzados solo vía barrel/`FinanceFacade`.
- [ ] Prefijo HTTP documentado como `/api/...` salvo health/Bull Board/Swagger que viven fuera o según `main.ts`.
- [ ] No presentar módulos `agenda` / `projects` / `health` como APIs Nest: solo slugs de `user_modules`.
- [ ] Actualizar `CHANGELOG.md` y subir `version` en `package.json`; cerrar con `chore(release): vX.Y.Z` y el tag.

## Pruebas obligatorias

Todo cambio corre, antes de darlo por terminado:

1. `pnpm format:check`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm test:e2e`

No hay excepción por tamaño ni por tipo: un cambio de documentación también corre los cuatro. Los E2E (`test/*.e2e-spec.ts`, Prisma mock) son requisito en **todo** cambio, no solo al tocar pruebas. Un test en rojo significa que el cambio no está terminado, y no se abre un PR con la suite en rojo. Un cambio de contrato (paginación, DTO, respuesta HTTP) que no actualice su E2E deja el CI en rojo. Detalle en [docs/operations/testing.md](docs/operations/testing.md).

## Observabilidad y CI

Sentry corre en el back (`instrument.ts`) y no se inicializa sin `SENTRY_DSN`. `pnpm sentry:sourcemaps` sube los source maps de `dist` con `@sentry/cli` cuando existe `SENTRY_AUTH_TOKEN`; sin token el build no falla. CI en [.github/workflows/ci.yml](.github/workflows/ci.yml) corre en `develop`: Prisma validate, `db:migrate deploy`, drift check (`db:migrate:diff:check`), lint, format, money guard, build, unit y e2e.

## Estructura de código

```text
apps/api/src/            # app Nest: main, app.module, health
packages/                # workspace pnpm; cada paquete compila a dist
  config/                # env Zod y límites de IA
  contracts/             # interfaces y tokens neutrales, sin dependencias
  core/                  # guards, filters, eventos y colas
  database/              # PrismaService, cliente generado, schema y migraciones
  logos/
  auth/
  users/
  finance/
  notifications/
  ai-agent/
docs/
```
