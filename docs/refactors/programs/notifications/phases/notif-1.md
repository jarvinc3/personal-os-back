# NOTIF-1 — Pipeline de entrega

**Issue:** [back #322](https://github.com/jarvinc3/personal-os-back/issues/322)

## Objetivo

Procesar intents mediante policy, persistencia y entrega por canal, conservando deduplicación e idempotencia.

## Alcance

Enrutar `NotificationIntent` por policy, almacenar el estado de lectura y despachar por los canales existentes. Mantener reintentos, colas, horas de silencio, preferencias globales y observabilidad.

## Gate

El mismo intent no crea notificaciones duplicadas; siguen pasando las pruebas de los canales actuales; un intent de prueba puede procesarse sin ningún tipo de Finance.

[Índice de fases de Notifications](README.md).
