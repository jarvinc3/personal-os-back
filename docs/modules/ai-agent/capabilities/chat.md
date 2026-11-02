# Conversaciones del agente (AI-9)

El backend conserva conversaciones privadas por usuario y ejecuta solo capacidades registradas con efecto `READ`. El runtime no importa módulos de dominio. El primer proveedor de Finance expone únicamente el resumen de ingresos, gastos y flujo confirmado de un mes, respetando la zona horaria y moneda base del usuario.

El bucle admite hasta cuatro rondas de llamadas a herramientas. Un módulo apagado o una capacidad fallida se devuelve al modelo con un código tipado sanitizado; la conversación puede continuar. No se ejecutan capacidades `WRITE` en AI-9.

Las conversaciones y sus mensajes se guardan en `ai_conversations` y `ai_conversation_messages`. El resumen privado vive en la conversación y solo se usa para reconstruir su contexto; no crea observaciones ni conocimiento global. AI-9 no programa purga automática: los mensajes completos permanecen hasta que el usuario borra la conversación, elimina sus datos AI o elimina su cuenta. El endpoint de exportación AI incluye conversaciones y mensajes.

La recuperación busca siempre por `userId` y devuelve 404 para una conversación ajena o inexistente. El borrado manual de datos incluye la rama `ai.conversations`.

## HTTP

Ver [contrato HTTP](../contracts/http.md#ai-9-conversaciones).

## Límite de interfaz

La vista web y la experiencia de chat siguen pendientes de decisión del owner. Esta fase solo publica API y runtime backend.

**Decisión pendiente del owner:** definir si las conversaciones deben expirar automáticamente y cuál sería el plazo. AI-9 mantiene el almacenamiento hasta borrado explícito.

## Evidencia

- `packages/ai-agent/src/conversations/`
- `packages/finance/src/ai/finance-ai-capabilities.spec.ts`
- `test/ai-agent.e2e-spec.ts`
