# Notifications — HTTP

Auth: JWT. Envelope `{ data, meta }`.

| Método | Path | Notas |
| --- | --- | --- |
| GET | `/api/notifications` | Query `page`, `limit`, `channel` (`IN_APP`\|`PUSH`\|`EMAIL`, default IN_APP), `unreadOnly`. Shape `{ items, pagination }`. Si `channels.inApp=false`, lista IN_APP vacía |
| GET | `/api/notifications/unread-count` | `{ count }` canal IN_APP |
| PATCH | `/api/notifications/read-all` | `{ updated }` |
| PATCH | `/api/notifications/:id/read` | Ownership |
| POST | `/api/notifications` | Crea para el usuario autenticado (no `userId` en body) |
| POST | `/api/notifications/push-tokens` | `{ platform, token }` |
| PATCH | `/api/notifications/push-tokens/:token/deactivate` | token URL-encoded |

`POST /notifications` aplica policy (`channels`, quiet hours, `data.moduleSlug` + `notificationKey`).
