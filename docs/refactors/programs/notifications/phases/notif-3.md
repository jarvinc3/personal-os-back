# NOTIF-3 — Preferencias mediante module settings

**Issue:** [back #324](https://github.com/jarvinc3/personal-os-back/issues/324)

## Objetivo

Consultar preferencias de notificación de módulos mediante el contrato genérico de settings, no mediante defaults específicos de Users.

## Alcance y gate

Resolver `sourceDomain` y `preferenceKey` a través del registro neutral de settings. Notifications puede evaluar la preferencia de un módulo nuevo sin incorporar sus constantes o defaults.

**Dependencia:** PLATFORM-SETTINGS-2.

[Índice de fases de Notifications](README.md).
