# Notifications — overview

## Propósito

Orquestar notificaciones in-app, push y email; tokens push; gateway Socket.IO.

## Alcance

- CRUD lista/unread/read para el usuario autenticado
- Registro/desactivación de push tokens (`platform`: ios | android | web)
- Policy: channels, quiet hours (suprime PUSH/EMAIL, no IN_APP), keys por módulo en `data`
- Processor cola `notifications`; EMAIL vía cola `email-sync` + Resend
- Listener de eventos finance con idempotencia; el copy y las claves de preferencia vienen de Finance, que también publica su adaptador de intents
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

El copy de los avisos financieros vive en `@personal-os/finance`; este módulo lo
importa mientras retira su interpretación de los eventos de Finance en NOTIF-2.

**Barrel:** `NotificationsModule`, `NotificationsService`, `NotificationsGateway`, `PushTokensService`, `NotificationPolicyService`.

Imports `DomainEventsModule` de Core solo por `DomainEventIdempotencyGuard`. Payload llega por EventEmitter2.
