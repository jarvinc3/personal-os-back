# Users Module

## Scope

User profile and module configuration management.

- Returns current user profile (`users` + module config + preferences).
- Supports partial profile updates.
- Handles per-module configuration updates (`user_modules`).

## Main Endpoints

- `GET /users/me` — get authenticated user profile.
- `PATCH /users/me` — update profile fields/preferences.
- `PATCH /users/me/modules/:slug` — update module config and enabled state.

## Notes

- `UsersModule` is marked as `@Global()`.
- Other modules consume `UsersService` directly (AI tools, settings sync, etc.).
- Module settings defaults are merged server-side to keep response shape stable.
