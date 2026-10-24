# Module folder standard

House style for NestJS feature modules under `packages/*/src/` (antes `src/modules/`). Feature modules first; technical layers **inside** each feature (or capability). References: `finance/` (complex), `ai-agent/` (capabilities without Nest submodules), `notifications/` / `users/` / `auth/` (simple layers).

## Principles

1. Organize by **feature / capability**, not a global `controllers/` + `services/` tree.
2. Inside a feature, use the same layer names everywhere: `presentation/`, `application/`, `infrastructure/`, optional `domain/`.
3. Module root holds only composition: `*.module.ts`, **required** `index.ts` public barrel, optional `*.facade.ts`.
4. **Cross-module imports** use only that barrel (or façade re-exported from it). Never import another module’s `domain/`, `infrastructure/`, `presentation/`, `application/`, or capability folders.
5. Prefer focused services over god services. Introduce ports only when there are ≥2 adapters, cross-capability DI, or tests that need a stable IO boundary.
6. Avoid new Nest circular imports (`forwardRef`). Prefer events or a façade over bidirectional module graphs.
7. Do not create empty layer folders as placeholders (e.g. auth has no `application/` until orchestration exists).

## Public API + enforcement

| Mechanism   | Where                                                                                |
| ----------- | ------------------------------------------------------------------------------------ |
| Barrels     | `packages/<name>/src/index.ts`                                                       |
| ESLint      | `no-restricted-imports` in `eslint.config.mjs` (fails CI on deep cross-module paths) |
| Cursor rule | `.cursor/rules/module-public-api.mdc` (`alwaysApply`)                                |

`index.ts` barrels may re-export internals; all other files must import sibling modules via the barrel.

## Simple module template

Use when the module is one bounded context (`auth`, `users`, `notifications`).

```text
module-name/
  module-name.module.ts
  index.ts                    # optional public re-exports
  presentation/
    *.controller.ts
    *.gateway.ts              # if needed
    dto/
  application/
    *.service.ts
    *.use-case.ts             # when orchestration is non-trivial
    *.listener.ts
    *.processor.ts
    ports/                    # only if ≥2 adapters
  infrastructure/
    *.repository.ts
    *.adapter.ts
  domain/                     # optional pure rules / defaults
```

## Complex module template

Use when there are ≥2 bounded contexts with their own lifecycle (e.g. `finance`, `ai-agent`).

```text
module-name/
  module-name.module.ts       # composition root
  module-name.facade.ts       # optional cross-module API
  index.ts
  shared/                     # domain + tokens shared by capabilities
  capability-a/
    capability-a.module.ts    # optional Nest submodule (finance yes; ai-agent no today)
    presentation/
    application/
      ports/
    infrastructure/
  capability-b/
    …same skeleton
```

`ai-agent` organizes code with capability folders (`inference/`, `chat/`, `actions/`, `runtime/`) plus top-level `tools/`, `prompts/`, `providers/`, `shared/`. `AiCoreModule` connects the provider kernel (`AiService`) to the neutral inference port in `contracts`; `AiModule` still imports Finance/Notifications until the controlled AI-0 cut.

## Layer dependency rules

```text
presentation → application → domain
infrastructure → application ports / domain
```

| Layer            | Owns                                             | Must not                        |
| ---------------- | ------------------------------------------------ | ------------------------------- |
| `presentation`   | HTTP, WS, inbound DTOs                           | Prisma, LLM SDKs, queue workers |
| `application`    | orchestration, listeners, thin processors, ports | framework transport details     |
| `domain`         | pure types/functions                             | Nest decorators, I/O            |
| `infrastructure` | Prisma repos, external adapters                  | HTTP controllers                |

## Naming

| Avoid                                | Prefer                                                                |
| ------------------------------------ | --------------------------------------------------------------------- |
| `lib/`, ambiguous `utils/`           | `domain/` or `application/` / `shared/` with a clear role             |
| Dumping runtime files at module root | Only `*.module.ts` (+ `index.ts` / façade)                            |
| Fat `*.service.ts` for many writes   | `*.use-case.ts` + query service (see finance ledger)                  |
| Port for every repository            | Concrete repo until a second adapter or cross-capability need appears |

## Heuristics

- **Add layers** when a module has ≥8 domain source files or mixes HTTP + queue + persistence in one folder.
- **Add capabilities** when there are ≥2 bounded contexts (ledger vs catalog; chat vs actions).
- **Add ports** only with 2+ adapters, mocked IO in tests at scale, or a cross-capability contract (e.g. `BUDGET_THRESHOLD_PORT`).

## Finance: use-case vs fat service

Within finance capabilities:

- **Use-cases** for distinct write flows with different rules (ledger mutations, Gmail sync processing, FX amount resolution).
- **Fat application services** for CRUD / read-heavy surfaces (catalog, planning, analytics).
- **`domain/`** stays in `shared/` until a capability owns non-shared pure rules.
- Details: [finance overview](../modules/finance/overview.md).

## References

| Module        | Style                                                  | Doc                                                  |
| ------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| finance       | Complex + Nest capability modules + façade             | [finance/](../modules/finance/README.md)             |
| ai-agent      | Complex folders, single Nest module                    | [ai-agent/](../modules/ai-agent/README.md)           |
| notifications | Simple layers (`EmailSyncProcessor` in infrastructure) | [notifications/](../modules/notifications/README.md) |
| users         | Simple layers                                          | [users/](../modules/users/README.md)                 |
| auth          | Simple layers (no empty application/)                  | [auth/](../modules/auth/README.md)                   |
| logos         | Simple layers + puertos de storage y brand             | [logos/](../modules/logos/README.md)                 |

## Completed roadmap

Former follow-ups from the ai-agent pass are done:

1. notifications — layers + `EmailSyncProcessor` under notifications infrastructure
2. users / auth — aligned to presentation / application / infrastructure / domain
3. finance — documented canonical shape and use-case vs fat-service (no code rewrite)
4. PR checklist — permanent rule below

## Comandos y consultas (CQS)

- Consultas (`get*`, `find*`, `list*`, `resolve*`): no mutan estado. No escriben, no calientan cachés ni disparan descargas.
- Comandos (use cases `execute`, `create*`, `update*`, `delete*`, `reverse*`): pueden devolver un resultado explícito de la operación (id, conteos) porque el llamador lo necesita; lo prohibido es un nombre de consulta con efectos.
- El trabajo de arranque (warm-up de logos, por ejemplo) vive en `onModuleInit` / `onApplicationBootstrap`, no en la primera consulta.

## PR checklist (for new work)

- [ ] New file lives under a named layer or capability, not module root (except module/index/facade).
- [ ] Cross-module consumers use façade / `index.ts` public exports, not deep infrastructure paths.
- [ ] New symbols needed outside a module are added to that module’s `index.ts` (keep the surface minimal).
- [ ] `pnpm lint` passes (`no-restricted-imports` boundaries).
- [ ] No new Nest circular dependency introduced.
- [ ] Specs sit next to the unit under test.
- [ ] Do not add empty placeholder layer folders.
