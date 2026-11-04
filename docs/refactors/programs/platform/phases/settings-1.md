# PLATFORM-SETTINGS-1 — Propiedad de settings por módulo

**Issue:** [back #320](https://github.com/jarvinc3/personal-os-back/issues/320)

## Objetivo

Mover defaults, validación y preferencias de notificación a los módulos que les dan significado.

## Alcance

Migrar settings de Finance, Agenda, Projects y Health a providers propiedad de cada módulo; quitar de `UsersService` métodos y validación específicos de Finance. Users conserva identidad, preferencias globales y orquestación de cuenta.

## Gate

Users ya no valida ni interpreta configuración específica de Finance. Agregar un campo de configuración de un módulo no requiere cambiar defaults centralizados de Users.

[Índice de fases de plataforma](README.md).
