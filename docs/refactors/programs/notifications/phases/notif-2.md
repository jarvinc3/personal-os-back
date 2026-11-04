# NOTIF-2 — Semántica de Finance fuera de Notifications

**Issue:** [back #323](https://github.com/jarvinc3/personal-os-back/issues/323)

## Objetivo

Mover el copy y el mapeo de eventos financieros a un adaptador propiedad de Finance.

## Alcance

Retirar de `NotificationsEventsListener` los payloads, claves y decisiones específicas de Finance. Los eventos de importación por email y su copy se eliminan con FIN-1, no se mantienen como huérfanos hasta esta fase.

## Gate

Notifications no contiene handlers, copy ni constantes de eventos de Finance. Finance crea intents y Notifications solo los procesa.

**Dependencias:** FIN-4 y NOTIF-1.

[Índice de fases de Notifications](README.md).
