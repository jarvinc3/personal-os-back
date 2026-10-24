# AI Agent — overview

## Propósito

Agente conversacional único: sesiones, tool-calling, acciones con confirmación, insights asíncronos. Un agente central, no uno por módulo; el contexto (`moduleSlug`) selecciona tools.

## Alcance

- Multi-provider: Groq, OpenCode, OpenRouter
- Cadena de respaldo en ese orden; cada proveedor entra solo si su key existe
- Chat JSON + SSE, idempotencia `clientMessageId`
- CRUD sesiones/mensajes; acciones PENDING execute/cancel
- Registry + `ToolExecutorService`; finance via `FinanceFacade` only
- Cola `ai-processing`; listener de eventos usuario/finance
- Extractores de Finance: inyectan `INFERENCE_COMPLETION` desde contracts, sin
  importar AI. AiCoreModule global conecta el puerto con el pool.

## Fuera de alcance

Tools de agenda/projects/health más allá de `get_user_context` / `update_module_config` / `toggle_module` (y notif settings donde aplica). No hay `docs/ai-tools/agenda-tools.md`.

## Arquitectura

```text
ai.module.ts          # composition root (imports Finance, Notifications)
ai-core.module.ts     # AI_PROVIDER + AiService
inference/           # AiService y pruebas del pool; independiente del chat
chat/ actions/ runtime/ providers/ tools/ prompts/ shared/
```

**Barrel:** `AiModule`, `AiCoreModule`, `AiService`, `AI_DATA_BRANCHES`.
Los límites de extracción e insights pertenecen a `@personal-os/config`.
