# NOTIF-3 — Preferencias mediante module settings

**Issue:** [back #324](https://github.com/jarvinc3/personal-os-back/issues/324)

## Objetivo

Consultar preferencias de notificación de módulos mediante el contrato genérico de settings, no mediante defaults específicos de Users.

## Alcance y gate

Resolver `sourceDomain` y `preferenceKey` a través del registro neutral de settings. Notifications puede evaluar la preferencia de un módulo nuevo sin incorporar sus constantes o defaults.

## Resultado

- El pipeline pasa a la policy el `sourceDomain` y el `preferenceKey` del intent; la policy resuelve el descriptor dueño con `hasDescriptor`, `read` y `notificationEnabled` del lector genérico.
- Notifications ya no deriva el módulo de `data.moduleSlug`; los creates directos mantienen ese campo como respaldo y no cambian su comportamiento.
- Un dominio nuevo con descriptor registrado evalúa su preferencia sin tocar Users ni Notifications; los motivos de bloqueo y las horas de silencio no cambian.

**Dependencia:** PLATFORM-SETTINGS-2.

[Índice de fases de Notifications](README.md).
