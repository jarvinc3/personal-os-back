# Capacidad: delivery y policy

## Flujo

1. Persistencia de la notificación **antes** del dispatch.
2. Emit `notification.created`.
3. Processor `notifications` para PUSH si el canal aplica.
4. EMAIL: encola `email-sync` solo si `EMAIL_DELIVERY_ENABLED=true`; si no, persist + warn (no throw).
5. `EmailSyncProcessor` resuelve `to` o `User.email` → `ResendEmailAdapter`.
6. Default usuario `channels.email: false` (opt-in).

## Finance

| Evento | IN_APP |
| --- | --- |
| `finance.transaction.confirmed` / `imported` / `updated` | Sí (idempotent claim) |
| `finance.budget.threshold_crossed` | Sí |
| `finance.transaction.deleted` | Claim; **no** toast |

## Quiet hours

`BR-NTF-001`: quiet hours suprime PUSH y EMAIL; IN_APP sigue visible.

## WS

Conexión Bearer → room `user:{sub}` → `notification.new`.

Evidencia: `notification-policy.service.ts`, `notifications.processor.ts`, `notifications-events.listener.ts`, e2e.
