# NOTIF-1 — Pipeline de entrega

**Issue:** [back #322](https://github.com/jarvinc3/personal-os-back/issues/322)

## Objetivo

Procesar intents mediante policy, persistencia y entrega por canal, conservando deduplicación e idempotencia.

## Alcance

Enrutar `NotificationIntent` por policy, almacenar el estado de lectura y despachar por los canales existentes. Mantener reintentos, colas, horas de silencio, preferencias globales y observabilidad.

## Resultado

- `NotificationIntentPipeline` implementa `NotificationIntentSink` y es el `NOTIFICATION_INTENT_SINK` del módulo: evalúa la policy por canal solicitado, persiste una fila por canal aceptado y entrega después del commit.
- El recibo del intent (`processed_domain_events`, consumidor `notifications:intent`) se escribe en la misma transacción que las filas, con clave `notification-intent:<userId>:<deduplicationKey>`. Un intent repetido no crea filas ni vuelve a entregar.
- La policy acepta `moduleSlug` y `preferenceKey` del intent y sigue leyendo `data.moduleSlug`/`data.notificationKey` como respaldo; una preferencia apagada o una hora de silencio descarta solo el canal afectado.
- La entrega reutiliza la de siempre: IN_APP por WebSocket tras el commit, PUSH y EMAIL por la cola `notifications` con reintentos y backoff. Un fallo del canal no duplica el registro persistido y el job puede reintentarse.
- No hay migración ni cambios de endpoints; el listener de eventos de Finance sigue como estaba hasta NOTIF-2.

## Gate

El mismo intent no crea notificaciones duplicadas; siguen pasando las pruebas de los canales actuales; un intent de prueba puede procesarse sin ningún tipo de Finance.

[Índice de fases de Notifications](README.md).
