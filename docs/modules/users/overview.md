# Users — overview

## Propósito

Perfil (`users`), preferencias JSONB y configuración por módulo (`user_modules`).

## Alcance

- `GET/PATCH/DELETE /api/users/me`
- `POST /api/users/me/data/wipe` (vaciado por capas, no cierra la cuenta)
- `PATCH /api/users/me/modules/:slug`
- `PATCH /api/users/me/release-notes-seen` (última versión de Novedades vista)
- Merge server-side de defaults (`GLOBAL_USER_PREFERENCES_DEFAULTS`, `DEFAULT_MODULE_CONFIG_BY_SLUG`)
- `UsersModule` es `@Global()`
- Outbox de borrado Auth: `AuthDeletionOutboxProcessor` cada minuto

## Fuera de alcance

Implementar módulos Nest para agenda/projects/health. Solo slugs y JSON config.

## Arquitectura

```text
presentation/   users.controller, dto/
application/    users.service, wipe-user-data.use-case, auth-deletion-outbox.processor
infrastructure/ users.repository
domain/         defaults/, parse-user-preferences, settings-merge, wipe-layers
```

**Barrel:** `UsersModule`, `UsersService`, `WipeUserDataUseCase`, `USER_DATA_WIPE_DOMAINS`, `UserDataWipeDomainsPort`, `UsersRepository`, `parseUserPreferences`, `mergeWithDefaults`, `GLOBAL_USER_PREFERENCES_DEFAULTS`, `AiTone`, `ParsedUserPreferences`, `FINANCE_NOTIFICATION_KEYS`, `DEFAULT_MODULE_CONFIG_BY_SLUG`, `ModuleSlug`, `MODULE_SLUGS`, `isModuleSlug`, `WIPE_LAYERS`, `WipeLayerId`, `expandWipeLayers`, `sortWipeLayers`.

Eventos: `user.preferences.updated`, `module.enabled`, `module.disabled`, `module.config.updated`, `user.data.wiped`.
