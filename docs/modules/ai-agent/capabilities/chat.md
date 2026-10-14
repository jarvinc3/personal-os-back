# Capacidad: chat y sesiones

## Endpoints

Ver [contracts/http.md](../contracts/http.md).

## Flujo chat

1. Cliente envía `sessionId?`, `clientMessageId?`, `context?`, `messages`.
2. Persistencia + runner + tools según `MODULE_CONTEXT` de la sesión.
3. `context` (`{ moduleSlug, screen?, entityRef?: { type, id } }`) se guarda como último contexto de la sesión. El runner resuelve la entidad con `FinanceFacade.resolveChatContextEntity` (dueño validado por `userId`); si no existe o es de otro usuario, la ignora. El resumen corto (tipo, nombre, saldo/estado e id) entra al prompt de sistema.
4. Mutating tools respetan `confirmBeforeActions` → acción PENDING.
5. Respuesta JSON o SSE (`start` → `chunk*` → `done`/`error`). `done` incluye `actions`, `sideEffects`, `blocks`.
6. `sideEffects`: `{ type: 'invalidate', keys }` o `{ type: 'theme', value }`.

Throttle 30/60s y timeout 30s en chat.

Evidencia: `chat/application/`, `AiChatTurnCoordinator`, e2e `test/ai-agent.e2e-spec.ts`.
