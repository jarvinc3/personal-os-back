# AGENTS.md — personal-os-back

Instrucciones para agentes y reviewers que trabajan en el backend de Personal OS.

## Orden de lectura

1. Este archivo.
2. [docs/README.md](docs/README.md) — mapa del repositorio.
3. [docs/documentation-standard.md](docs/documentation-standard.md) — taxonomía, IDs, anti-duplicación.
4. El módulo o área que vas a tocar bajo `docs/modules/` o `docs/infrastructure/`.
5. Código y pruebas citados en esos documentos. No inferir desde nombres.

Si una afirmación no está `VERIFICADO`, leer [docs/review-register.md](docs/review-register.md) antes de tratarla como comportamiento vigente.

## Fuentes canónicas

| Tema | Dónde |
| --- | --- |
| Dominio, REST, Prisma, eventos, colas, seguridad | este repositorio (`docs/` + `src/` + `packages/`) |
| UI, rutas Next.js, Web Push del navegador | `personal-os-web` |
| Envelope HTTP `{ data, meta }` | `packages/core/src/interceptors/transform.interceptor.ts` |
| Eventos | `packages/core/src/events/event.constants.ts` |
| Env | `packages/config/src/env.schema.ts` |
| Tools IA | `packages/ai-agent/src/tools/tool.registry.ts` + `prompts/module-context.ts` |
| API pública entre módulos Nest | `packages/<nombre>/src/index.ts` y barrels `@personal-os/<nombre>` (regla `.cursor/rules/module-public-api.mdc`) |

## Checklist al cambiar comportamiento

- [ ] Actualizar el documento dueño (capacidad, regla o contrato), no un README monolítico.
- [ ] Si el cambio no se puede verificar, añadir un `REV-BACK-*` en el registro.
- [ ] Imports cruzados solo vía barrel/`FinanceFacade`.
- [ ] Prefijo HTTP documentado como `/api/...` salvo health/Bull Board/Swagger que viven fuera o según `main.ts`.
- [ ] No presentar módulos `agenda` / `projects` / `health` / `subscriptions` como APIs Nest: solo slugs de `user_modules`.

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
