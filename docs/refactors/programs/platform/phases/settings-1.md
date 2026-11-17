# PLATFORM-SETTINGS-1 — Propiedad de settings por módulo

**Issue:** [back #320](https://github.com/jarvinc3/personal-os-back/issues/320)

## Objetivo

Mover defaults, validación y preferencias de notificación a los módulos que les dan significado.

## Alcance

Migrar settings de Finance, Agenda, Projects y Health a providers propiedad de cada módulo; quitar de `UsersService` métodos y validación específicos de Finance. Users conserva identidad, preferencias globales y orquestación de cuenta.

## Resultado

- `packages/finance/src/settings/` es dueño de los defaults, las claves de notificación y los límites de Finance; su descriptor valida y la interpretación de destinatarios del resumen semanal vive en Finance.
- Intelligence mantiene los defaults del módulo `ai`; Agenda, Projects y Health los declaran en `apps/api/src/module-settings/descriptors/`.
- Users pierde `DEFAULT_MODULE_CONFIG_BY_SLUG`, las claves de Finance y los validadores: valida el slug con `ModuleSettingsRegistry.has`, aplica el parche del descriptor y persiste. El reset de settings usa los defaults registrados.
- Notifications evalúa los toggles con los defaults del descriptor registrado; la clave de notificación sigue siendo de Finance.
- El formato persistido y la API no cambian.

## Gate

Users ya no valida ni interpreta configuración específica de Finance. Agregar un campo de configuración de un módulo no requiere cambiar defaults centralizados de Users.

[Índice de fases de plataforma](README.md).
