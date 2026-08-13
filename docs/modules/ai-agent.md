# AI Agent Module

## Scope

Conversational AI orchestration with session persistence, action execution, and tool-calling.

- Multi-provider inference routing (Groq, Cerebras, OpenRouter).
- Session/message persistence and idempotent chat handling.
- Structured tool registry + tool executor side effects.
- Action lifecycle: pending, execute, cancel.
- SSE and JSON chat responses.
- Queue processor for async AI processing jobs.

## Architecture

Single Nest composition root (`AiModule`) under `src/modules/ai-agent/`. Code is grouped by **capability folders** with layers inside; there are no Nest submodules (avoids extra `forwardRef` with Finance). House standard: [docs/architecture/modules.md](../architecture/modules.md).

```text
src/modules/ai-agent/
  ai.module.ts
  index.ts                         # public API
  chat/
    presentation/                  # AiController, AiSessionsController, dto/
    application/                   # AiService, runner, turn coordinator, sessions, limits, prompts helper
    infrastructure/                # AiSessionsRepository, AiChatPersistenceService
  actions/
    presentation/                  # AiActionsController
    application/                   # AiActionsService, AiActionsReaperService
    infrastructure/                # AiActionsRepository
  runtime/
    application/                   # AiEventsListener, AiProcessingProcessor, AiMemoryService
  providers/                       # Groq, Cerebras, OpenRouter adapters
  tools/                           # tool.registry, ToolExecutorService, arg schemas
  prompts/                         # system / tools / module-context strings
  shared/                          # types, AI_PROVIDER token, message mappers, stream helpers
```

### Public API (`index.ts`)

`AiModule`, `AiService`, `resolveMaxEmailLlmExtracts`, `DEFAULT_MAX_EMAIL_LLM_EXTRACTS`, `resolveDailyInsightQuota`, `DEFAULT_DAILY_INSIGHT_QUOTA`.

Import as `from '../ai-agent'` (or `src/modules/ai-agent`). Do not import capability folders from outside.

## Main Endpoints

- `GET /ai/providers`
- `POST /ai/chat`
- `POST /ai/chat/stream`
- `GET /ai/sessions`
- `POST /ai/sessions`
- `GET /ai/sessions/:id`
- `DELETE /ai/sessions/:id`
- `GET /ai/sessions/:id/actions`
- `POST /ai/actions/:id/execute`
- `POST /ai/actions/:id/cancel`

## Internal Components

| Area | Path | Components |
| --- | --- | --- |
| Chat HTTP | `chat/presentation/` | `AiController`, `AiSessionsController` |
| Chat orchestration | `chat/application/` | `AiService`, `AiAgentRunner`, `AiChatTurnCoordinator`, `AiSessionsService`, `ai-limits` |
| Chat persistence | `chat/infrastructure/` | `AiSessionsRepository`, `AiChatPersistenceService` |
| Actions | `actions/*` | `AiActionsController`, `AiActionsService`, `AiActionsRepository`, reaper |
| Runtime | `runtime/application/` | `AiEventsListener`, `AiProcessingProcessor` (queue `ai-processing`), `AiMemoryService` |
| Tools | `tools/` | `tool.registry.ts`, `ToolExecutorService` |
| Providers | `providers/` | Groq / Cerebras / OpenRouter |

## Notes

- Module imports `NotificationsModule` for realtime response events and delivery.
- Module imports `FinanceModule` (via `forwardRef`) so finance tools can execute through `ToolExecutorService` → `FinanceFacade`.
- Tool availability is context-based via `MODULE_CONTEXT` in `prompts/module-context.ts` (general, finance, etc.).
