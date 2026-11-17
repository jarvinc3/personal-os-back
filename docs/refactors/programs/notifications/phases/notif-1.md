# NOTIF-1 — Pipeline de entrega

**Issue:** [back #322](https://github.com/jarvinc3/personal-os-back/issues/322)

## Objetivo

Procesar intents mediante policy, persistencia y entrega por canal, conservando deduplicación e idempotencia.

## Alcance

Enrutar `NotificationIntent` por policy, almacenar el estado de lectura y despachar por los canales existentes. Mantener reintentos, colas, horas de silencio, preferencias globales y observabilidad.

## Resultado

- `NotificationIntentPipeline` implementa `NotificationIntentSink` y es el `NOTIFICATION_INTENT_SINK` del módulo: evalúa la policy por canal solicitado, persiste una fila por canal aceptado y entrega después del commit.
- El recibo del canal (`processed_domain_events`, consumidor `notifications:intent:<canal>`) y el puntero a la fila (`notifications:intent-row:<recibo>:<canal>`) se escriben en la misma transacción que la fila. Un intent repetido no crea filas.
- La entrega es retriable: el recibo `notifications:intent-delivered:<canal>` de la fila marca el envío; si falta, el pipeline reentrega la fila persistida, incluso cuando el encolado falló después del commit. PUSH y EMAIL usan `jobId` igual al id de la notificación, así que reencolar no duplica el job.
- La policy acepta `moduleSlug` y `preferenceKey` del intent y sigue leyendo `data.moduleSlug`/`data.notificationKey` como respaldo; una preferencia apagada o una hora de silencio descarta solo el canal afectado.
- La entrega reutiliza la de siempre: IN_APP por WebSocket tras el commit, PUSH y EMAIL por la cola `notifications` con reintentos y backoff.
- No hay migración ni cambios de endpoints; el listener de eventos de Finance sigue como estaba hasta NOTIF-2.

## Gate

El mismo intent no crea notificaciones duplicadas; siguen pasando las pruebas de los canales actuales; un intent de prueba puede procesarse sin ningún tipo de Finance.

[Índice de fases de Notifications](README.md).
