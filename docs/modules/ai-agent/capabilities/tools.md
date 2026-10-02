# Capacidad: tools

Fuente: `packages/ai-agent/src/tools/tool.registry.ts` y `prompts/module-context.ts`.

`MODULE_CONTEXT_SLUGS`: `general`, `agenda`, `projects`, `health`, `subscriptions`, `finance`.

Siempre puede añadirse `switch_module_context`.

`targetModule` de tools core es `core` salvo helpers de módulos (`modules`).

Finance: ver [finance-tools](../../finance/contracts/finance-tools.md). General: [core-tools](../contracts/core-tools.md).

**BR-AI-001:** mutating tools respetan `confirmBeforeActions`.

**BR-AI-002:** `update_module_config` / `toggle_module` slugs `agenda|projects|health|subscriptions`; **finance slug rechazado** en `update_module_config` (config finance no editable por chat).
