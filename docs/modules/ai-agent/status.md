# AI Agent — estado

Fecha: 2026-10-14

| Ítem                                           | Estado                        | Evidencia                            |
| ---------------------------------------------- | ----------------------------- | ------------------------------------ |
| Chat + stream + sessions                       | `implemented`                 | controllers + e2e                    |
| Tools general + finance                        | `implemented`                 | `tool.registry.ts`                   |
| Actions + reaper 5 min                         | `implemented`                 | `AiActionsReaperService`             |
| Contexto de entidad (`ChatContext.entityRef`) | `implemented` | `core/src/ai/chat-context.ts`, `chat-context.dto.ts`, `ai-agent.runner.ts`; guardado en `ai_agent_sessions.chat_context` (v0.23.x) |
| Bloques visuales del chat | `implemented` | `ChatBlock` en `shared/ai.types.ts`: `transaction_card`, `transaction_list`, `budget_progress`, `loan_summary`, `chart` (v0.24.x) |
| Tools de comercios y recurrentes | `implemented` | `list_merchants`, `list_subscriptions`, `confirm_recurring` en `tool.registry.ts` (v0.25.x) |
| Contextos agenda/projects/health/subscriptions | `implemented` (tools mínimas) | `MODULE_CONTEXT`                     |
| Tools de producto de esos slugs                | `planned`                     | no hay registry extra — REV-BACK-008 |
