# FIN-4 — Eventos e intents de Finance

**Issue:** [back #318](https://github.com/jarvinc3/personal-os-back/issues/318)

## Objetivo

Mantener en Finance la semántica de sus eventos y mensajes, y crear `NotificationIntent` mediante adaptadores propios del dominio.

## Alcance

Finance decide cuándo un hecho financiero debe notificarse y crea el intent con el copy y la clave de preferencia de Finance. El transporte y la entrega siguen en la plataforma y Notifications.

## Gate

Añadir una notificación de Finance no requiere editar un switch central en Notifications. Los contratos de evento de Finance no vuelven al catálogo semántico de Core.

**Dependencia:** coordinar con NOTIF-2 para retirar la interpretación de Finance del listener.

[Índice de fases de Finance](README.md).
