# Capacidad: consulta de entidades en lote

`POST /api/finance/entities/lookup` — de solo lectura, para que la web pinte la card canónica de una entidad sin repetir reglas ni pedir el catálogo aparte. Lo consume el chat de IA (`entity_card` / `entity_list`) y el patrimonio (`entity` de cada línea).

## Contrato

- Cuerpo `{ refs: [{ type, id }] }`, de 1 a 50 referencias. `type` debe ser uno de: `transaction`, `account`, `card`, `loan`, `budget`, `savingsGoal`, `receivable`, `subscription`, `merchant`, `category`.
- Respuesta: `data` es una lista con la **misma cantidad y orden** que `refs`. Cada posición trae la entidad completa, con la misma representación pública que su endpoint propio, o `null` si ya no existe, está archivada o pertenece a otro usuario.
- Un tipo desconocido o más de 50 referencias responden 400 (`ValidationPipe`).
- Solo devuelve entidades del usuario autenticado: una referencia ajena se trata como inexistente y nunca revela que existe.
- No registra actividad del usuario ni emite eventos.

## Forma de cada entidad

| `type`         | Misma forma que                         |
| -------------- | --------------------------------------- |
| `transaction`  | `GET /api/finance/transactions/:id`     |
| `account`      | `GET /api/finance/accounts/:id`         |
| `card`         | `GET /api/finance/cards/:id`            |
| `loan`         | `GET /api/finance/loans/:id`            |
| `budget`       | `GET /api/finance/budgets/:id`          |
| `savingsGoal`  | `GET /api/finance/savings-goals/:id`    |
| `receivable`   | `GET /api/finance/receivables/:id`      |
| `subscription` | `GET /api/finance/subscriptions/:id`    |
| `merchant`     | `GET /api/finance/merchants/:id`        |
| `category`     | Categoría visible (propia o de sistema) |

## Costo

Una consulta a la base por tipo presente, no una por referencia: los 20 movimientos de una lista cuestan lo mismo que uno. La institución de cuentas y tarjetas llega dentro de la entidad (nombre, logo y color), así que la web no pide el catálogo aparte.

Evidencia: `entities/application/finance-entity-lookup.service.ts`, `entities/presentation/entities.controller.ts` y su spec.
