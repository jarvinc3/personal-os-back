# AI Agent — HTTP

Auth: JWT. Envelope `{ data, meta }` salvo SSE.

| Método | Path | Notas |
| --- | --- | --- |
| GET | `/api/ai/providers` | `{ providers: [{ name, model }] }` |
| POST | `/api/ai/chat` | `{ sessionId?, clientMessageId?, messages }` → content, actions, sideEffects, blocks |
| POST | `/api/ai/chat/stream` | Mismo body; SSE |
| GET | `/api/ai/sessions` | Paginado |
| POST | `/api/ai/sessions` | `{ moduleSlug?, contextType? }` |
| GET | `/api/ai/sessions/:id` | Incluye messages / memorySnapshot |
| DELETE | `/api/ai/sessions/:id` | |
| GET | `/api/ai/sessions/:id/actions` | |
| POST | `/api/ai/actions/:id/execute` | |
| POST | `/api/ai/actions/:id/cancel` | |
