# Users — HTTP

Auth: Bearer JWT. Envelope `{ data, meta }`.

| Método | Path | Body | Notas |
| --- | --- | --- | --- |
| GET | `/api/users/me` | — | Perfil + preferences mergeadas + `userModules` |
| PATCH | `/api/users/me` | `UpdateProfileDto` parcial | Email read-only; preferences merge |
| DELETE | `/api/users/me` | — | Cascade app data + outbox Auth; 404 si no hay fila `users` |
| POST | `/api/users/me/data/wipe` | `{ layers: WipeLayerId[] }` (min 1, únicos) | Vaciado por capas sin cerrar la cuenta. 200 con `requestedLayers`, `appliedLayers` y `counts`. Auto-expande `finance.catalog` → `finance.ledger` y `finance.categories` → `finance.planning`. 400 capas vacías o desconocidas |
| PATCH | `/api/users/me/modules/:slug` | `{ isEnabled?, config? }` | Slug: `finance` \| `agenda` \| `projects` \| `subscriptions` \| `health` |

`preferences` no guarda config de módulo; eso va en `user_modules.config`.

La fila `users` la crea un trigger de Supabase al signup (checklist web/back). Sin fila, `GET /users/me` falla.

Evidencia: `users.controller.ts`, `users.service.spec.ts`, `test/users.e2e-spec.ts`.

Wipe: `WipeUserDataUseCase` expande capas, delega en el port `USER_DATA_WIPE_DOMAINS` (adapter en `apps/api/src/user-data-wipe`), emite un único `user.data.wiped` y devuelve conteos. Idempotente: capas ya vacías → `counts` en 0.
