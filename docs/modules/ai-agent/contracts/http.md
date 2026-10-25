# AI Agent — HTTP

Auth: JWT. Envelope `{ data, meta }` salvo SSE.

| Método | Path                           | Notas                                                                                          |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| GET    | `/api/ai/providers`            | `{ providers: [{ name, model }] }`                                                             |
| POST   | `/api/ai/chat`                 | `{ sessionId?, clientMessageId?, context?, messages }` → content, actions, sideEffects, blocks |
| POST   | `/api/ai/chat/stream`          | Mismo body; SSE                                                                                |
| GET    | `/api/ai/sessions`             | Paginado                                                                                       |
| POST   | `/api/ai/sessions`             | `{ moduleSlug?, contextType?, context? }`                                                      |
| GET    | `/api/ai/sessions/:id`         | Incluye messages / memorySnapshot / chatContext                                                |
| DELETE | `/api/ai/sessions/:id`         |                                                                                                |
| GET    | `/api/ai/sessions/:id/actions` |                                                                                                |
| POST   | `/api/ai/actions/:id/execute`  |                                                                                                |
| POST   | `/api/ai/actions/:id/cancel`   |                                                                                                |

AI-3 (JWT):

| Método | Path                                                  | Notas                                                                                             |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| GET    | `/api/intelligence/dataset`                           | Conteos `TRAIN`, `VALIDATION`, `HOLDOUT` de `EMAIL_V1`, filtrados por cuenta                      |
| GET    | `/api/intelligence/review-queue?cursor=...`           | Cola de mensajes sin verificación, keyset-paginada y aislada por usuario                          |
| POST   | `/api/intelligence/messages/:messageId/verifications` | `CONFIRMED`, `CORRECTED` o `REJECTED`; guarda secuencia y marca HOLDOUT como verdad de referencia |
| GET    | `/api/intelligence/runs`                              | Runs del usuario con configuración, versiones y watermarks de evidencia                           |

`GET /api/intelligence/messages/:messageId` incluye `provenance.observations` y `provenance.verifications` en orden de secuencia.
