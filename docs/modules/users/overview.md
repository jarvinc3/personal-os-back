# Users — overview

## Propósito

Perfil (`users`), preferencias JSONB y configuración por módulo (`user_modules`).

## Alcance

- `GET/PATCH/DELETE /api/users/me`
- `PATCH /api/users/me/modules/:slug`
- Merge server-side de defaults (`GLOBAL_USER_PREFERENCES_DEFAULTS`, `DEFAULT_MODULE_CONFIG_BY_SLUG`)
- `UsersModule` es `@Global()`
- Outbox de borrado Auth: `AuthDeletionOutboxProcessor` cada minuto

## Fuera de alcance

Implementar módulos Nest para agenda/projects/health/subscriptions. Solo slugs y JSON config.

## Arquitectura

```text
presentation/   users.controller, dto/
application/    users.service, auth-deletion-outbox.processor
infrastructure/ users.repository
domain/         defaults/, parse-user-preferences, settings-merge
```

**Barrel:** `UsersModule`, `UsersService`, `UsersRepository`, `parseUserPreferences`, `mergeWithDefaults`, `GLOBAL_USER_PREFERENCES_DEFAULTS`, `AiTone`, `ParsedUserPreferences`, `FINANCE_NOTIFICATION_KEYS`, `DEFAULT_MODULE_CONFIG_BY_SLUG`, `ModuleSlug`, `MODULE_SLUGS`, `isModuleSlug`.

Eventos: `user.preferences.updated`, `module.enabled`, `module.disabled`, `module.config.updated`.
