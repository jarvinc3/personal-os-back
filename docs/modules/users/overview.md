# Users — overview

## Propósito

Perfil (`users`), preferencias JSONB y configuración por módulo (`user_modules`).

## Alcance

- `GET/PATCH/DELETE /api/users/me`
- `GET /api/users/me/data/branches` y `POST /api/users/me/data/wipe` (vaciado por ramas, no cierra la cuenta)
- `PATCH /api/users/me/modules/:slug`
- `PATCH /api/users/me/release-notes-seen` (última versión de Novedades vista)
- Merge server-side de defaults (`GLOBAL_USER_PREFERENCES_DEFAULTS`, `DEFAULT_MODULE_CONFIG_BY_SLUG`)
- `UsersModule` es `@Global()`
- Outbox de borrado Auth: `AuthDeletionOutboxProcessor` cada minuto
- El alta Auth crea el perfil por trigger; un borrado directo en Auth elimina el
  perfil y sus datos relacionados por cascada. La ruta de cuenta de la app borra
  primero el perfil y usa el outbox para borrar Auth.

## Fuera de alcance

Implementar módulos Nest para agenda/projects/health. Solo slugs y JSON config.

## Arquitectura

```text
presentation/   users.controller, dto/
application/    users.service, wipe-user-data.use-case, auth-deletion-outbox.processor
infrastructure/ users.repository
domain/         defaults/, parse-user-preferences, settings-merge, data-branches, settings-data-branches
```

**Barrel:** `UsersModule`, `UsersService`, `WipeUserDataUseCase`, `USER_DATA_WIPE_DOMAINS`, `UserDataWipeDomainsPort`, `UsersRepository`, `parseUserPreferences`, `mergeWithDefaults`, `GLOBAL_USER_PREFERENCES_DEFAULTS`, `AiTone`, `ParsedUserPreferences`, `FINANCE_NOTIFICATION_KEYS`, `DEFAULT_MODULE_CONFIG_BY_SLUG`, `ModuleSlug`, `MODULE_SLUGS`, `isModuleSlug`, `DATA_APP`, `DataBranchDescriptor`, `DataAppBranches`, `expandDataBranches`, `groupDataBranchCounts`, `isKnownDataBranch`, `SETTINGS_DATA_BRANCHES`, `SETTINGS_DEFAULTS_BRANCH`.

Eventos: `user.preferences.updated`, `module.enabled`, `module.disabled`, `module.config.updated`, `user.data.wiped`.
