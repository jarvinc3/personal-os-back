# AI Agent Module

## Scope

Conversational AI orchestration with session persistence, action execution, and tool-calling.

- Multi-provider inference routing (Groq, Cerebras, OpenRouter).
- Session/message persistence and idempotent chat handling.
- Structured tool registry + tool executor side effects.
- Action lifecycle: pending, execute, cancel.
- SSE and JSON chat responses.
- Queue processor for async AI processing jobs.

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

- Runner: `AiAgentRunner`
- Persistence: `AiChatPersistenceService`, `AiSessionsRepository`
- Actions: `AiActionsService`, `AiActionsRepository`
- Tools: `tool.registry.ts`, `ToolExecutorService`
- Events: `AiEventsListener`
- Queue worker: `AiProcessingProcessor` (queue: `ai-processing`)

## Notes

- Module imports `NotificationsModule` for realtime response events and delivery.
- Module imports `FinanceModule` so finance tools can execute through `ToolExecutorService`.
- Tool availability is context-based via `MODULE_CONTEXT` (general, finance, etc.).
