# WebSocket

Gateway: `src/modules/notifications/presentation/notifications.gateway.ts`.

| Campo | Valor |
| --- | --- |
| Namespace | `/notifications` |
| Auth | Bearer extraído del handshake; disconnect si falta/inválido |
| Room | `user:{sub}` |
| CORS | `CORS_ORIGIN` (en production lista estricta; en non-prod callback) |

Eventos emitidos hacia cliente (consumidos por web): `notification.new`, `ai.response`, `ping` (si se usa).

Detalle de payloads de chat: módulo [ai-agent](../modules/ai-agent/README.md) y contratos web.
