# FIN-0 — Contratos de frontera

**Issue:** [back #242](https://github.com/jarvinc3/personal-os-back/issues/242)

**PR:** [back #302](https://github.com/jarvinc3/personal-os-back/pull/302)

## Objetivo

Definir contratos propios de Finance para eventos, capacidades y contexto de IA, señales e intents de notificación antes de mover las implementaciones.

## Alcance

Establecer contratos versionados del dominio y adaptadores que eviten que IA y otros módulos dependan de un facade universal. No cambiar el comportamiento de negocio de Finance.

## Gate

Las reglas de imports pueden expresar las dependencias permitidas; los contratos de Finance no dependen de Gmail, del runtime de chat ni de la implementación de Notifications.

[Índice de fases de Finance](README.md).
