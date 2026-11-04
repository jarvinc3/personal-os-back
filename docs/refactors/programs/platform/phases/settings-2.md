# PLATFORM-SETTINGS-2 — Migración de consumidores

**Issue:** [back #321](https://github.com/jarvinc3/personal-os-back/issues/321)

## Objetivo

Migrar guards, schedulers y consumidores de preferencias a contratos genéricos o consultas propiedad del dominio.

## Alcance

Notifications, los guards de módulos y los procesos programados dejan de leer defaults específicos desde Users. Mantener en cada módulo las consultas cuya semántica pertenece al dominio.

## Gate

Notifications no importa defaults de módulos desde Users; un módulo nuevo puede aportar preferencias sin cambios en consumidores compartidos.

**Dependencia:** PLATFORM-SETTINGS-1.

[Índice de fases de plataforma](README.md).
