# Capacidad: runtime (insights)

`AiEventsListener` consume login, preferences, module.*, finance transaction/budget/email_sync y encola `ai-processing`.

`AiProcessingProcessor` genera insights; `AiMemoryService` actualiza `memorySnapshot`.

Cuotas: `resolveDailyInsightQuota`; `AI_DAILY_INSIGHT_QUOTA` validada en `env.schema` (default 20).
