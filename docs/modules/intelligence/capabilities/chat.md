# Conversaciones del agente (AI-9)

El backend conserva conversaciones privadas por usuario y ejecuta solo capacidades registradas con efecto `READ`. El runtime no importa módulos de dominio. El primer proveedor de Finance expone únicamente el resumen de ingresos, gastos y flujo confirmado de un mes, respetando la zona horaria y moneda base del usuario.

El bucle admite hasta cuatro rondas de llamadas a herramientas. Un módulo apagado o una capacidad fallida se devuelve al modelo con un código tipado sanitizado; la conversación puede continuar. No se ejecutan capacidades `WRITE` en AI-9.

Las conversaciones y sus mensajes se guardan en `ai_conversations` y `ai_conversation_messages`. El resumen privado vive en la conversación y solo se usa para reconstruir su contexto; no crea observaciones ni conocimiento global. La API acepta contexto de invocación opcional (`route`, `view` o `sheet`, `entityRef` y `filters`) al crear la conversación o enviar un mensaje. `entityRef.type` se limita a los tipos que Finance puede resolver (`transaction`, `account`, `card`, `loan`, `budget`, `savings_goal`, `receivable`, `subscription`, `merchant`, `category`). Las referencias se resuelven con consultas acotadas al usuario autenticado; una referencia no disponible se rechaza antes de persistir el contexto o el mensaje. La clave de equivalencia para #357 es SHA-256 de la serialización JSON canónica del contexto: las claves de objetos se ordenan recursivamente por unidades de código, sin depender del locale, y se conservan valores y distinción entre vista y sheet. El contexto se agrega al prompt como dato no confiable. AI-9 no programa purga automática: los mensajes completos permanecen hasta que el usuario borra la conversación, elimina sus datos AI o elimina su cuenta. El endpoint de exportación AI incluye conversaciones y mensajes.

Cada conversación contextual guarda esa clave en `ai_conversations.context_key`, indexada por usuario y fecha de actualización. `GET /api/intelligence/conversations/latest?context=<sha256>` devuelve `{ "conversation": null }` cuando no hay coincidencia, o la conversación propia más reciente con contexto y mensajes visibles. La búsqueda siempre filtra por el dueño autenticado y nunca cae a una clave distinta.

La recuperación busca siempre por `userId` y devuelve 404 para una conversación ajena o inexistente. El borrado manual de datos incluye la rama `ai.conversations`.

## HTTP

Ver [contrato HTTP](../contracts/http.md#conversaciones-ai-9).

## Límite de interfaz

La vista web y la experiencia de chat siguen pendientes de decisión del owner. Esta fase solo publica API y runtime backend.

**Decisión pendiente del owner:** definir si las conversaciones deben expirar automáticamente y cuál sería el plazo. AI-9 mantiene el almacenamiento hasta borrado explícito.

## Evidencia

- `packages/intelligence/src/conversations/`
- `packages/finance/src/ai/finance-ai-capabilities.spec.ts`
- `test/intelligence.e2e-spec.ts`
