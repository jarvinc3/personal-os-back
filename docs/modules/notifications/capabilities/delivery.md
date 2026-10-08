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

## Copy y datos por movimiento

El payload de estos eventos trae `currency`, `type`, `merchant`, `accountName`,
`cardName`, `categoryName`, `categoryIcon` y `categoryColor` (armado en
`packages/finance/src/shared/domain/mappers.ts`). El listener traduce a texto en
español y formatea el monto con `formatNotificationAmount` (`domain/notification-copy.ts`):

| Tipo | Título |
| --- | --- |
| `transaction.created` | `Gasto registrado` / `Ingreso registrado` / `Transferencia registrada` |
| `transaction.imported_pending` | `Movimiento por confirmar` |
| `transaction.updated` | `Movimiento actualizado` |
| `budget.threshold_reached` | `Presupuesto al N%` |

El `data` guarda `transactionId`, `amount`, `currency`, `merchant`, `categoryName`,
`categoryIcon`, `categoryColor`, `accountName`, `cardName` y `status`, para que la
web muestre el ícono de categoría y abra el detalle del movimiento.

## Quiet hours

`BR-NTF-001`: quiet hours suprime PUSH y EMAIL; IN_APP sigue visible.

## WS

Conexión Bearer → room `user:{sub}` → `notification.new`.

Evidencia: `notification-policy.service.ts`, `notifications.processor.ts`, `notifications-events.listener.ts`, e2e.
