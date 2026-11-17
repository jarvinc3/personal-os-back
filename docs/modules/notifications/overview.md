# Notifications — overview

## Propósito

Orquestar notificaciones in-app, push y email; tokens push; gateway Socket.IO.

## Alcance

- CRUD lista/unread/read para el usuario autenticado
- Registro/desactivación de push tokens (`platform`: ios | android | web)
- Policy: channels, quiet hours (suprime PUSH/EMAIL, no IN_APP) y preferencia del módulo mediante `MODULE_SETTINGS_READER` a partir del `sourceDomain` y `preferenceKey` del intent
- Processor cola `notifications`; EMAIL vía cola `email-sync` + Resend
- Listener de eventos de plataforma; los dominios envían intents al `NOTIFICATION_INTENT_SINK` (Finance usa su propio listener)
- Gateway namespace `/notifications`

## Fuera de alcance

- FCM/APNs nativo completo como único sender (hay Expo token + Web Push VAPID)
- UI (web)

## Arquitectura

```text
presentation/   controller, gateway, dto/
application/    service, policy, push-tokens, events listener, notifications processor, email port
infrastructure/ repository, push-sender, resend-email.adapter, email-sync.processor
domain/         quiet-hours
```

Finance traduce sus eventos en su propio listener; este módulo no importa tipos
ni copy de Finance.

**Barrel:** `NotificationsModule`, `NotificationIntentModule`, `NotificationsService`, `NotificationsGateway`, `PushTokensService`, `NotificationPolicyService`.

Imports `DomainEventsModule` de Core solo por `DomainEventIdempotencyGuard`. Payload llega por EventEmitter2.

## Pipeline de intents

`NotificationIntentPipeline` (token `NOTIFICATION_INTENT_SINK`) procesa un intent
validado: evalúa la policy por cada canal solicitado, escribe una fila por canal
aceptado con su recibo (`processed_domain_events`, consumidores
`notifications:intent:<canal>` y `notifications:intent-row:<recibo>:<canal>`) y
entrega después del commit.

La entrega es retriable. Antes de enviar, el pipeline comprueba el recibo
`notifications:intent-delivered:<canal>` de la fila; si falta, entrega y lo
escribe después. Un fallo de encolado deja el canal pendiente: el reintento del
mismo intent encuentra el recibo y el puntero de la fila, no crea otra fila y
vuelve a encolar. El job de PUSH/EMAIL usa `jobId` igual al id de la notificación,
así que reencolar la misma fila no duplica el job mientras la cola lo conserva.

La entrega es la vigente: WebSocket para IN_APP, cola `notifications` para PUSH
y EMAIL con sus reintentos. Los productores de dominio envían sus intents al
sink; Finance lo hace desde su propio listener y este módulo no conoce sus
tipos. NOTIF-3 moverá la lectura de preferencias a los providers genéricos.
