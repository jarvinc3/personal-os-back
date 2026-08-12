# Users Module

## Scope

User profile and module configuration management.

- Returns current user profile (`users` + module config + preferences).
- Supports partial profile updates.
- Handles per-module configuration updates (`user_modules`).

## Architecture

Simple-module layers under `src/modules/users/` (see [docs/architecture/modules.md](../architecture/modules.md)). Root holds only `users.module.ts`.

```text
src/modules/users/
  users.module.ts
  presentation/      # users.controller, dto/
  application/       # users.service, auth-deletion-outbox.processor
  infrastructure/    # users.repository
  domain/            # defaults/, parse-user-preferences, settings-merge
```

## Main Endpoints

- `GET /users/me` — get authenticated user profile.
- `PATCH /users/me` — update profile fields/preferences.
- `DELETE /users/me` — delete authenticated user, cascade app data, remove Supabase Auth user.
- `PATCH /users/me/modules/:slug` — update module config and enabled state.

## Notes

- `UsersModule` is marked as `@Global()`.
- Other modules consume `UsersService` / `UsersRepository` via the Nest module (DI); preference helpers live under `domain/`.
- Module settings defaults are merged server-side to keep response shape stable.
