# Auth Module

## Scope

Authentication context resolution based on Supabase JWT.

- Validates incoming bearer tokens with Supabase JWT strategy.
- Exposes the authenticated session payload for frontend bootstrap.
- Emits login event for downstream modules.

## Main Endpoint

- `GET /auth/session` — returns authenticated user context from JWT claims.

## Notes

- Module uses `PassportModule` with `supabase-jwt` as default strategy.
- `AuthController.session` emits `AppEvents.USER_LOGGED_IN`.
- Guarding is handled globally via core guards/decorators.
