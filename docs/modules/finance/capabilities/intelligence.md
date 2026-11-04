# Capacidad de Finance para Intelligence (AI-9)

`FinanceAiCapabilities` implementa el contrato neutral `AiCapabilityProvider` dentro de Finance. Intelligence registra y ejecuta el provider; el runtime no importa `FinanceFacade`.

## `finance_monthly_summary`

- Efecto: `READ`.
- Entrada: `month` en formato `AAAA-MM`.
- Resultado: `baseCurrency`, `income`, `expenses` y `cashFlow`, todos los montos como cadenas decimales.
- Fuente: `AnalyticsService.getAnalyticsSummary`, que agrega solo movimientos `CONFIRMED` y aplica las reglas financieras vigentes para transferencias.
- Intervalo: límites del mes local convertidos a UTC con la zona horaria guardada en `users.timezone`.
- Disponibilidad: requiere que el módulo `finance` esté habilitado para el usuario; si está apagado, responde `CAPABILITY_UNAVAILABLE`.

No acepta `userId` en argumentos. Finance deriva el usuario de `AiExecutionContext` autenticado. No se escriben movimientos ni otros datos de dominio.

**Código y pruebas:** `packages/finance/src/ai/finance-ai-capabilities.ts` y `finance-ai-capabilities.spec.ts`.
