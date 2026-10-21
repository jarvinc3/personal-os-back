# Users — HTTP

Auth: Bearer JWT. Envelope `{ data, meta }`.

| Método | Path                               | Body                                        | Notas                                                                                                                                                                                                                         |
| ------ | ---------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/users/me`                    | —                                           | Perfil + preferences mergeadas + `userModules` + `lastSeenReleaseVersion` (nullable)                                                                                                                                          |
| PATCH  | `/api/users/me`                    | `UpdateProfileDto` parcial                  | Email read-only; preferences merge                                                                                                                                                                                            |
| DELETE | `/api/users/me`                    | —                                           | Cascade app data + outbox Auth; 404 si no hay fila `users`                                                                                                                                                                    |
| POST   | `/api/users/me/data/wipe`          | `{ layers: WipeLayerId[] }` (min 1, únicos) | Vaciado por capas sin cerrar la cuenta. 200 con `requestedLayers`, `appliedLayers` y `counts`. Auto-expande `finance.catalog` → `finance.ledger` y `finance.categories` → `finance.planning`. 400 capas vacías o desconocidas |
| PATCH  | `/api/users/me/modules/:slug`      | `{ isEnabled?, config? }`                   | Slug: `finance` \| `agenda` \| `projects` \| `health`. Un slug retirado como `subscriptions` responde 400                                                                                                                     |
| PATCH  | `/api/users/me/release-notes-seen` | `{ version }` (X.Y.Z)                       | Guarda la última versión de Novedades vista en `users.last_seen_release_version`. 400 si el formato no es X.Y.Z; 404 sin fila `users`                                                                                         |

`preferences` no guarda config de módulo; eso va en `user_modules.config`.

`preferences.regional` agrupa las preferencias de región. `weekStartsOn` acepta `0` (domingo), `1` (lunes), `6` (sábado) o `null`; `null` resuelve el primer día desde `users.locale` (`Intl.Locale.weekInfo`, lunes si el locale no lo expone). `PATCH /users/me` responde 400 para cualquier otro valor y `GET /users/me` devuelve lo guardado, sin resolver. Los valores `weekStartsOn` que quedaron en `user_modules.config` de Finanzas y Agenda se copian al perfil con `pnpm db:backfill-week-starts-on` (`--dry-run` para revisar).

La fila `users` la crea un trigger de Supabase al signup (checklist web/back). Sin fila, `GET /users/me` falla.

Evidencia: `users.controller.ts`, `users.service.spec.ts`, `test/users.e2e-spec.ts`.

Wipe: `WipeUserDataUseCase` expande capas, delega en el port `USER_DATA_WIPE_DOMAINS` (adapter en `apps/api/src/user-data-wipe`), emite un único `user.data.wiped` y devuelve conteos. Idempotente: capas ya vacías → `counts` en 0.
