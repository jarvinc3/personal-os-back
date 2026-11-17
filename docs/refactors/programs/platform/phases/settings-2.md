# PLATFORM-SETTINGS-2 — Migración de consumidores

**Issue:** [back #321](https://github.com/jarvinc3/personal-os-back/issues/321)

## Objetivo

Migrar guards, schedulers y consumidores de preferencias a contratos genéricos o consultas propiedad del dominio.

## Alcance

Notifications, los guards de módulos y los procesos programados dejan de leer defaults específicos desde Users. Mantener en cada módulo las consultas cuya semántica pertenece al dominio.

## Resultado

- La policy de Notifications consulta `MODULE_SETTINGS_READER` (`hasDescriptor`, `read`, `notificationEnabled`) en vez del registro y sus defaults; conserva los mismos motivos de bloqueo (`module_disabled_or_missing`, `module_notification_disabled:<slug>.<key>`).
- `EnabledModuleGuard` deja de consultar `user_module` con Prisma y usa `hasDescriptor`/`read` del lector; un slug sin descriptor sigue respondiendo 403.
- El lector expone `hasDescriptor(slug)` y lo delega en el registro; ningún consumidor compartido importa defaults de un módulo.
- Finance y Agenda, Projects y Health siguen resolviendo sus propias reglas desde sus descriptores.
- Sin cambios de formato guardado, respuestas HTTP ni textos.

## Gate

Notifications no importa defaults de módulos desde Users; un módulo nuevo puede aportar preferencias sin cambios en consumidores compartidos.

**Dependencia:** PLATFORM-SETTINGS-1.

[Índice de fases de plataforma](README.md).
