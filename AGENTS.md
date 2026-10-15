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

Si una afirmación no está `VERIFICADO`, leer [docs/review-register.md](docs/review-register.md) antes de tratarla como comportamiento vigente.

## Fuentes canónicas

| Tema                                             | Dónde                                                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Dominio, REST, Prisma, eventos, colas, seguridad | este repositorio (`docs/` + `src/` + `packages/`)                                                                |
| UI, rutas Next.js, Web Push del navegador        | `personal-os-web`                                                                                                |
| Envelope HTTP `{ data, meta }`                   | `packages/core/src/interceptors/transform.interceptor.ts`                                                        |
| Eventos                                          | `packages/core/src/events/event.constants.ts`                                                                    |
| Env                                              | `packages/config/src/env.schema.ts`                                                                              |
| Tools IA                                         | `packages/ai-agent/src/tools/tool.registry.ts` + `prompts/module-context.ts`                                     |
| API pública entre módulos Nest                   | `packages/<nombre>/src/index.ts` y barrels `@personal-os/<nombre>` (regla `.cursor/rules/module-public-api.mdc`) |

## Changelog y versión

Toda sesión de agente cierra con un release: `CHANGELOG.md` actualizado y `version` de `package.json` subida. Antes de escribirlo, lee [docs/reference/changelog-guide.md](docs/reference/changelog-guide.md) completo; ahí están las reglas, las secciones y un ejemplo.

La versión sigue **estrictamente** [docs/versionado.md](docs/versionado.md): beta `0.MINOR.PATCH`, nunca bajar de versión, `1.0.0` solo cuando el usuario lo decida y los hitos de módulo como nombre de release.

- Un release por sesión, aunque el cambio sea pequeño. El bump es el más alto de la sesión: `MAJOR` si rompe un contrato o los datos guardados, `MINOR` si agrega un endpoint o un dato nuevo y `PATCH` en el resto.
- Una sola versión para el monorepo: el `package.json` de la raíz. Los paquetes de `packages/*` no se publican por separado.
- El CHANGELOG va en español, de la versión más nueva a la más vieja, con la fecha en `AAAA-MM-DD`.
- Cierra con `chore(release): vX.Y.Z` y crea el tag `vX.Y.Z`.
- La documentación también pasa prettier: `pnpm format:check` cubre `ts`, `tsx` y `md`.
- `personal-os-app` está fuera de servicio y no sigue esta regla.

## Fechas

Usa siempre la fecha real del sistema (`date`) para nombrar migraciones, changelogs y documentos. No adelantes la fecha para "ordenar" artefactos: el nombre de la carpeta de una migración Prisma (`YYYYMMDDHHMMSS_slug`) es su posición en el historial y Prisma lo ordena de forma lexicográfica. Ver [docs/infrastructure/database.md](docs/infrastructure/database.md#migraciones-y-fechas).

## Checklist al cambiar comportamiento

- [ ] Correr `pnpm lint`, `pnpm test` y `pnpm test:e2e` (obligatorio en todo cambio).
- [ ] Correr `pnpm format:check`; un archivo sin formato o un test en rojo bloquea el cierre.
- [ ] Actualizar el documento dueño (capacidad, regla o contrato), no un README monolítico.
- [ ] Si el cambio no se puede verificar, añadir un `REV-BACK-*` en el registro.
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

## Estructura de código

```text
apps/api/src/            # app Nest: main, app.module, health
packages/                # workspace pnpm; cada paquete compila a dist
  config/                # env Zod y límites de IA
  core/                  # guards, filters, eventos, colas, puerto de chat IA
  database/              # PrismaService, cliente generado, schema y migraciones
  logos/
  auth/
  users/
  finance/
  notifications/
  ai-agent/
docs/
```
