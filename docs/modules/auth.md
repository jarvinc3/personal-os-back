# Auth Module

## Scope

Authentication context resolution based on Supabase JWT.

- Validates incoming bearer tokens with Supabase JWT strategy.
- Exposes the authenticated session payload for frontend bootstrap.
- Emits login event for downstream modules.

## Architecture

Simple-module layers under `src/modules/auth/` (see [docs/architecture/modules.md](../architecture/modules.md)). Root holds `auth.module.ts` + `index.ts`. No empty `application/` folder until orchestration services exist.

```text
src/modules/auth/
  auth.module.ts
  index.ts            # public API
  presentation/       # auth.controller
  infrastructure/     # JWT strategy, verifier, supabase-admin, JWKS helpers
    strategies/
  domain/             # supabase-jwt-payload types
```

### Public API (`index.ts`)

`AuthModule`, `SupabaseAdminService`, `SupabaseJwtVerifierService`, `SupabaseJwtStrategy`, `AuthUserContext`, `SupabaseJwtPayload`.

Import as `from '../auth'` (or `src/modules/auth`).

## Main Endpoint

- `GET /auth/session` — returns authenticated user context from JWT claims.

## Notes

- Module uses `PassportModule` with `supabase-jwt` as default strategy.
- `AuthController.session` emits `AppEvents.USER_LOGGED_IN` (debounced via cache key `user.logged_in:{sub}`, TTL 3600s).
- Guarding is handled globally via core guards/decorators.
