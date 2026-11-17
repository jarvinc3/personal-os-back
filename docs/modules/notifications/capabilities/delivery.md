# Capacidad: delivery y policy

## Frontera NotificationIntent (NOTIF-0)

Notifications expone `NotificationIntentConsumer` desde
`@personal-os/contracts` y registra `NotificationIntentReceiver` detrás de su
token. El receiver valida la versión, campos, canales, datos JSON y causa del
intent de forma neutral respecto del dominio. Notifications procesa el intent
por el pipeline y no interpreta eventos, payloads ni copy de ningún dominio.

## Flujo

1. Persistencia de la notificación **antes** del dispatch.
2. Emit `notification.created`.
3. Processor `notifications` para PUSH si el canal aplica.
4. EMAIL: encola `email-sync` solo si `EMAIL_DELIVERY_ENABLED=true`; si no, persist + warn (no throw).
5. `EmailSyncProcessor` resuelve `to` o `User.email` → `ResendEmailAdapter`.
6. Default usuario `channels.email: false` (opt-in).

## Productores

Los dominios traducen sus propios eventos a `NotificationIntent` y los envían al
sink. Finance lo hace con `FinanceNotificationsListener`: toma cada evento del
outbox, lo pasa por `FinanceNotificationIntents` y entrega cada intent a
`NOTIFICATION_INTENT_SINK` (token de `@personal-os/contracts`). El copy, el
`data` y la regla de «un hecho, un aviso» viven en
[eventos de Finance](../../finance/capabilities/events.md); Notifications no
contiene handlers, payloads ni textos de ese dominio.

`NotificationIntentModule` (global) expone el sink para que los productores
inyecten el token sin importar `@personal-os/notifications`.

La policy resuelve el estado y la preferencia del módulo con el `sourceDomain`
del intent y su `preferenceKey`, a través de `MODULE_SETTINGS_READER`. Los
creates directos siguen leyendo `data.moduleSlug`/`data.notificationKey` como
respaldo; Notifications no conoce claves ni defaults de ningún dominio.

## Quiet hours

`BR-NTF-001`: quiet hours suprime PUSH y EMAIL; IN_APP sigue visible.

## WS

Conexión Bearer → room `user:{sub}` → `notification.new`.

Evidencia: `notification-policy.service.ts`, `notification-intent.pipeline.ts`,
`notifications.processor.ts`, `finance-notifications.listener.ts` (Finance), e2e.
