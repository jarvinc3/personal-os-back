# Auth — HTTP

Prefijo: `/api` (`API_PREFIX`). Auth: Bearer JWT.

| Método | Path | Auth | Descripción |
| --- | --- | --- | --- |
| GET | `/api/auth/session` | JWT | Payload de usuario desde claims; emite `user.logged_in` si no hay cache |

**BR-AUTH-001:** máximo un evento `user.logged_in` por usuario y hora (cache).

**AC-AUTH-001:** Given JWT válido, When GET session, Then 200 y contexto. Given token inválido, Then 401.

Evidencia: `src/modules/auth/presentation/auth.controller.ts`; e2e `test/auth.e2e-spec.ts`.
