# Users Module

## Scope

User profile and module configuration management.

- Returns current user profile (`users` + module config + preferences).
- Supports partial profile updates.
- Handles per-module configuration updates (`user_modules`).

## Architecture

Simple-module layers under `src/modules/users/` (see [docs/architecture/modules.md](../architecture/modules.md)). Root holds `users.module.ts` + `index.ts`.

```text
src/modules/users/
  users.module.ts
  index.ts           # public API
  presentation/      # users.controller, dto/
  application/       # users.service, auth-deletion-outbox.processor
  infrastructure/    # users.repository
  domain/            # defaults/, parse-user-preferences, settings-merge
```

### Public API (`index.ts`)

`UsersModule`, `UsersService`, `UsersRepository`, `parseUserPreferences`, `mergeWithDefaults`, `GLOBAL_USER_PREFERENCES_DEFAULTS`, `AiTone`, `ParsedUserPreferences`, `FINANCE_NOTIFICATION_KEYS`, `DEFAULT_MODULE_CONFIG_BY_SLUG`, `ModuleSlug`, `MODULE_SLUGS`, `isModuleSlug`.

Import as `from '../users'` (or `src/modules/users`), not deep layer paths.

## Main Endpoints

- `GET /users/me` — get authenticated user profile.
- `PATCH /users/me` — update profile fields/preferences.
- `DELETE /users/me` — delete authenticated user, cascade app data, remove Supabase Auth user.
- `PATCH /users/me/modules/:slug` — update module config and enabled state.

## Notes

- `UsersModule` is marked as `@Global()`.
- Other modules consume `UsersService` / `UsersRepository` via Nest DI (import `UsersModule`) and type/helpers via the public barrel.
- Module settings defaults are merged server-side to keep response shape stable.
- A missing `UserModule` row is treated as disabled (same rule as notification policy `module_disabled_or_missing`). Finance REST returns 403 `Finance module is disabled`; other domain APIs are unchanged until they opt in with `@RequiresEnabledModule`.
