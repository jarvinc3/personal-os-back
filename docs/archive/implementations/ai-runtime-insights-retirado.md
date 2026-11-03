# Runtime de insights (retirado)

> Documento histórico. El runtime de insights, la cola `ai-processing` y la memoria de sesión fueron retirados en la oleada AI-0/AI-9. Se conserva como registro; no describe el comportamiento vigente.

`AiEventsListener` consume login, preferences, module.*, finance transaction/budget/email_sync y encola `ai-processing`.

`AiProcessingProcessor` genera insights; `AiMemoryService` actualiza `memorySnapshot`.

Cuotas: `resolveDailyInsightQuota`; `AI_DAILY_INSIGHT_QUOTA` validada en `env.schema` (default 20).
