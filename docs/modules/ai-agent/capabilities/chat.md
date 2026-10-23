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

## Bloques nativos

- `blocks` los arma el back a partir del resultado de las tools de lectura; el modelo nunca les da forma. Tipos vigentes: `markdown`, `action`, `entity_card`, `entity_list` y `chart`.
- `entity_card` trae `ref: { type, id }` y `entity_list` trae `refs: [{ type, id }]` (más `moreHref` opcional). El bloque **no** copia datos de la entidad: la web resuelve las referencias con `POST /api/finance/entities/lookup` (ver `docs/modules/finance/capabilities/entities.md`) y pinta la card canónica con el dato actual. Así el chat nunca muestra una copia desactualizada.
- `list_transactions` produce hasta 5 referencias de movimiento; `get_transaction`, una. `get_budget_status` produce hasta 3 presupuestos (el nombrado en el mensaje o los más cerca del límite) y `list_loans` una referencia por préstamo.
- `action` se rehidrata en cada lectura con el estado vigente de la acción; `markdown` y `chart` no cambian.

Throttle 30/60s y timeout 30s en chat.

Evidencia: `chat/application/`, `AiChatTurnCoordinator`, e2e `test/ai-agent.e2e-spec.ts`.
