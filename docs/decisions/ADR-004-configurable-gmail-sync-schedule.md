# ADR-004: Frecuencia de sincronización de Gmail configurable por usuario

- Estado: `accepted`
- Fecha: 2026-10

## Contexto

El sync automático de Gmail corre al boot de la API y cada 6 horas fijas (`GMAIL_AUTO_SYNC_INTERVAL_MS`, `@Cron(EVERY_6_HOURS)`). El usuario no puede elegir intervalo ni horas del día.

## Decisión

- La frecuencia vive por usuario en `UserModule.config.emailSync.schedule` y aplica a todos sus buzones: `{ mode: 'interval', everyMinutes }` (mínimo 15) o `{ mode: 'times', times: ['HH:MM', ...] }` interpretado en `User.timezone`.
- El default es `{ mode: 'interval', everyMinutes: 360 }`, igual al comportamiento actual.
- La validación ocurre en el borde de `updateModuleConfig` (slug `finance`); `emailSync.automatic` sigue siendo el interruptor maestro.
- `GmailAutoSyncScheduler` corre cada minuto y encola solo fuentes vencidas; el cálculo de vencimiento usa la config y la zona horaria del usuario.

## Alternativas

Frecuencia por buzón; cron por usuario; tabla de programación dedicada; mantener las 6 horas fijas.

## Consecuencias

`EnqueueDueGmailSyncsUseCase` deja de filtrar por cutoff SQL y calcula el vencimiento en código. `UserModule.config` crece dentro del límite de 8 000 caracteres ya validado. La hoja de ajustes de Finanzas gana modo, intervalo y horas. El boot de la API sigue encolando fuentes vencidas.
