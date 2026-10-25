# WebSocket

Gateway: `packages/notifications/src/presentation/notifications.gateway.ts`.

| Campo     | Valor                                                              |
| --------- | ------------------------------------------------------------------ |
| Namespace | `/notifications`                                                   |
| Auth      | Bearer extraído del handshake; disconnect si falta/inválido        |
| Room      | `user:{sub}`                                                       |
| CORS      | `CORS_ORIGIN` (en production lista estricta; en non-prod callback) |

Eventos emitidos hacia cliente (consumidos por web): `notification.new`, `ai.response`, `ai.email.sync.updated` y `ping` (si se usa).

`ai.email.sync.updated` se entrega a `user:{sub}` con `{ state }`. El estado contiene etapa, situación, contadores del lote, intento, próxima espera y una categoría de error segura; nunca contiene mensajes, cuerpos, tokens ni respuestas crudas de Gmail. El estado durable se obtiene con `GET /api/intelligence`; WebSocket solo comunica cambios en vivo.

Detalle de payloads de chat: módulo [ai-agent](../modules/ai-agent/README.md) y contratos web.
