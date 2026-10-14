# AI Agent — overview

## Propósito

Agente conversacional único: sesiones, tool-calling, acciones con confirmación, insights asíncronos. Un agente central, no uno por módulo; el contexto (`moduleSlug`) selecciona tools.

## Alcance

- Multi-provider: Groq, Cerebras, OpenRouter
- Chat JSON + SSE, idempotencia `clientMessageId`
- CRUD sesiones/mensajes; acciones PENDING execute/cancel
- Registry + `ToolExecutorService`; finance via `FinanceFacade` only
- Cola `ai-processing`; listener de eventos usuario/finance
- Extractor de emails bancarios: Finance ingestion importa **`AiCoreModule`** (no `AiModule`) para evitar ciclos Nest

## Fuera de alcance

Tools de agenda/projects/health más allá de `get_user_context` / `update_module_config` / `toggle_module` (y notif settings donde aplica). No hay `docs/ai-tools/agenda-tools.md`.

## Arquitectura

```text
ai.module.ts          # composition root (imports Finance, Notifications)
ai-core.module.ts     # AI_PROVIDER + AiService
chat/ actions/ runtime/ providers/ tools/ prompts/ shared/
```

**Barrel:** `AiModule`, `AiCoreModule`, `AiService`, `resolveMaxEmailLlmExtracts`, `DEFAULT_MAX_EMAIL_LLM_EXTRACTS`, `resolveDailyInsightQuota`, `DEFAULT_DAILY_INSIGHT_QUOTA`.
