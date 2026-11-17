# NOTIF-2 — Semántica de Finance fuera de Notifications

**Issue:** [back #323](https://github.com/jarvinc3/personal-os-back/issues/323)

## Objetivo

Mover el copy y el mapeo de eventos financieros a un adaptador propiedad de Finance.

## Alcance

Retirar de `NotificationsEventsListener` los payloads, claves y decisiones específicas de Finance. Los eventos de importación por email y su copy se eliminan con FIN-1, no se mantienen como huérfanos hasta esta fase.

## Resultado

- `FinanceNotificationsListener` vive en Finance, escucha sus eventos del outbox, los traduce con `FinanceNotificationIntents` y entrega cada intent a `NOTIFICATION_INTENT_SINK`; no importa `@personal-os/notifications`.
- `NotificationsEventsListener` conserva solo eventos de plataforma y el paquete Notifications pierde la dependencia de `@personal-os/finance`.
- `NotificationIntentModule` expone el sink de forma global para que los productores inyecten el token de contracts.
- Una prueba de arquitectura falla si Finance importa Notifications o al revés.
- La integración con PostgreSQL cubre la persistencia atómica del intent y el reintento de entrega sin duplicar la fila.
- Textos, preferencias, deduplicación y canales no cambian.

## Gate

Notifications no contiene handlers, copy ni constantes de eventos de Finance. Finance crea intents y Notifications solo los procesa.

**Dependencias:** FIN-4 y NOTIF-1.

[Índice de fases de Notifications](README.md).
