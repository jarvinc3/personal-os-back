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

| Método | Path                                                      | Notas                                                                                                        |
| ------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/intelligence/dataset`                               | Conteos `TRAIN`, `VALIDATION`, `HOLDOUT` de `EMAIL_V1`, filtrados por cuenta                                 |
| GET    | `/api/intelligence/review-queue?partition=...&cursor=...` | Cola sin verificar, ordenada por fecha recibida ascendente; incluye conteos pendientes por partición y total |
| POST   | `/api/intelligence/messages/:messageId/verifications`     | `CONFIRMED`, `CORRECTED` o `REJECTED`; guarda secuencia y marca HOLDOUT como verdad de referencia            |
| GET    | `/api/intelligence/runs`                                  | Runs del usuario con configuración, versiones y watermarks de evidencia                                      |
| POST   | `/api/intelligence/email/reset`                           | Requiere `{ "confirmed": true }`; vacía el corpus de correo y derivados del usuario, conserva OAuth          |

`GET /api/intelligence/messages/:messageId` incluye `provenance.observations` y `provenance.verifications` en orden de secuencia.
