# Capacidad: chat y sesiones

## Endpoints

Ver [contracts/http.md](../contracts/http.md).

## Flujo chat

1. Cliente envía `sessionId?`, `clientMessageId?`, `messages`.
2. Persistencia + runner + tools según `MODULE_CONTEXT` de la sesión.
3. Mutating tools respetan `confirmBeforeActions` → acción PENDING.
4. Respuesta JSON o SSE (`start` → `chunk*` → `done`/`error`). `done` incluye `actions`, `sideEffects`, `blocks`.
5. `sideEffects`: `{ type: 'invalidate', keys }` o `{ type: 'theme', value }`.

Throttle 30/60s y timeout 30s en chat.

Evidencia: `chat/application/`, `AiChatTurnCoordinator`, e2e `test/ai-agent.e2e-spec.ts`.
