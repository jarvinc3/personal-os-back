# Capacidad: runtime (insights)

`AiEventsListener` consume login, preferences, module.*, finance transaction/budget/email_sync y encola `ai-processing`.

`AiProcessingProcessor` genera insights; `AiMemoryService` actualiza `memorySnapshot`.

Cuotas: `resolveDailyInsightQuota` / `process.env.AI_DAILY_INSIGHT_QUOTA` (REV-BACK-002).
