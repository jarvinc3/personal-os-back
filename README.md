# Personal OS — Backend

**Estado:** beta (0.x). Política de versiones en [docs/versionado.md](./docs/versionado.md).

API NestJS para Personal OS: auth Supabase, usuarios, finanzas, notificaciones, agente IA y núcleo transversal.

**Documentación:** [docs/README.md](./docs/README.md) · [AGENTS.md](./AGENTS.md) · [Glosario: App y módulo](./docs/glosario.md)

## Inicio rápido

Ver [docs/operations/quick-start.md](./docs/operations/quick-start.md).

```bash
cp .env.example .env
pnpm install
pnpm db:generate
pnpm start:dev
```

- API: `http://localhost:$PORT/api` (ejemplo: `3100`)
- Swagger: `http://localhost:$PORT/docs` (off en production)

## Estructura

```text
apps/api/src                                    # app Nest: main, app.module, health
packages/{config,core,database,logos,auth,users,finance,notifications,ai-agent}/src
docs/
```

UNLICENSED — uso privado.
