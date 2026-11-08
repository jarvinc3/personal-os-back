# Capacidad: delivery y policy

## Frontera NotificationIntent (NOTIF-0)

Notifications expone `NotificationIntentConsumer` desde
`@personal-os/contracts` y registra `NotificationIntentReceiver` detrás de su
token. El receiver valida la versión, campos, canales, datos JSON y causa del
intent de forma neutral respecto del dominio. No crea una notificación ni
despacha canales; el pipeline existente conserva su comportamiento hasta
NOTIF-1. Los dominios pueden producir intents mediante `IntentProducer` sin
importar tipos de Finance.

## Flujo

1. Persistencia de la notificación **antes** del dispatch.
2. Emit `notification.created`.
3. Processor `notifications` para PUSH si el canal aplica.
4. EMAIL: encola `email-sync` solo si `EMAIL_DELIVERY_ENABLED=true`; si no, persist + warn (no throw).
5. `EmailSyncProcessor` resuelve `to` o `User.email` → `ResendEmailAdapter`.
6. Default usuario `channels.email: false` (opt-in).

## Finance

| Evento                                      | IN_APP                |
| ------------------------------------------- | --------------------- |
| `finance.transaction.confirmed` / `updated` | Sí (idempotent claim) |
| `finance.budget.threshold_crossed`          | Sí                    |
| `finance.transaction.deleted`               | Claim; **no** toast   |

## Copy y datos por movimiento

El payload de estos eventos trae `currency`, `type`, `merchant`, `accountName`,
`cardName`, `categoryName`, `categoryIcon` y `categoryColor` (armado en
`packages/finance/src/shared/domain/mappers.ts`). El listener traduce a texto en
español y formatea el monto con `formatNotificationAmount` (`domain/notification-copy.ts`):

| Tipo                       | Título                                                                 |
| -------------------------- | ---------------------------------------------------------------------- |
| `transaction.created`      | `Gasto registrado` / `Ingreso registrado` / `Transferencia registrada` |
| `transaction.updated`      | `Movimiento actualizado`                                               |
| `budget.threshold_reached` | `Presupuesto al N%`                                                    |

El `data` guarda `transactionId`, `amount`, `currency`, `merchant`, `categoryName`,
`categoryIcon`, `categoryColor`, `accountName`, `cardName` y `status`, para que la
web muestre el ícono de categoría y abra el detalle del movimiento.

### Un hecho, un aviso

Un movimiento que solo existe como efecto interno de una acción ya confirmada en
pantalla no se anuncia: el aporte o retiro de una meta y el gasto de un abono a
capital viajan con `announce: false` en el payload del evento, y el listener no
crea la notificación de `transaction.created` ni la de transferencia para ellos.
La pantalla ya mostró «Aporte registrado» o «Abono aplicado», así que el usuario
no lee el mismo hecho dos veces. Un gasto o ingreso registrado a mano, uno importado que ya está confirmado o uno creado por el agente de IA siguen avisando igual, porque no llevan esa marca. Un movimiento importado que queda `PENDING` no avisa hasta confirmarse; al confirmarse usa `transaction.created`.

## Quiet hours

`BR-NTF-001`: quiet hours suprime PUSH y EMAIL; IN_APP sigue visible.

## WS

Conexión Bearer → room `user:{sub}` → `notification.new`.

Evidencia: `notification-policy.service.ts`, `notifications.processor.ts`, `notifications-events.listener.ts`, e2e.
