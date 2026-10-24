# Capacidad: comercios

Catálogo de comercios por usuario: nombre visible, clave normalizada, alias, categoría y logo. Un movimiento, un correo importado o un patrón recurrente se enlazan al comercio por su clave.

## Endpoints

| Método | Path                               | Notas                                                    |
| ------ | ---------------------------------- | -------------------------------------------------------- |
| GET    | `/api/finance/merchants`           | Paginado por cursor; incluye gasto y movimientos del mes |
| GET    | `/api/finance/merchants/suggest`   | Mejor comercio conocido para un nombre escrito           |
| POST   | `/api/finance/merchants`           | Crea un comercio a mano                                  |
| GET    | `/api/finance/merchants/:id`       | Detalle                                                  |
| PATCH  | `/api/finance/merchants/:id`       | Renombra, define categoría o logo                        |
| POST   | `/api/finance/merchants/:id/merge` | Mueve movimientos y patrones a otro comercio             |
| POST   | `/api/finance/merchants/:id/logo`  | Sube un logo propio (PNG, JPG o WEBP, 1 MB)              |

## Creación manual

`POST /finance/merchants` acepta `name` (obligatorio, 1–120), `categoryId` opcional y `aliases` opcional (hasta 20 nombres de 1–120, se recortan, se descartan vacíos y repetidos).

- El nombre se guarda tal como se escribió; la clave de búsqueda sale de `normalizeMerchant`.
- Responde 201 con la misma forma que el detalle, con el gasto del mes en cero si es nuevo.
- Un nombre sin texto utilizable tras normalizar responde 400 «El nombre del comercio no tiene texto utilizable».
- Un `categoryId` que el usuario no puede ver responde 400 «Categoría no encontrada».
- Si la clave ya existe para el usuario responde 409 con `existingMerchantId`, para que la web ofrezca abrirlo o unirlo.
- Un comercio creado a mano es el que se reutiliza cuando después llega un movimiento con ese mismo nombre.

Evidencia: `merchants/application/merchants.service.ts`, `merchants/presentation/merchants.controller.ts` y su spec.

## Categoría del comercio

Cada comercio recuerda una sola categoría y expone de dónde salió (`categorySource`), para que la web la muestre como sugerencia mientras no sea definitiva.

| `categorySource` | Origen                                         | ¿Definitiva? |
| ---------------- | ---------------------------------------------- | ------------ |
| `MANUAL`         | La puso o la confirmó el usuario               | Sí           |
| `LEARNED`        | La trajo un movimiento con ese comercio        | No           |
| `KEYWORD`        | Coincidencia de palabras con una lista interna | No           |

- Precedencia: a mano, luego aprendida, luego palabra clave. Un origen menor nunca reemplaza a uno mayor: una categoría `MANUAL` no la toca ningún proceso automático, y una `LEARNED` no se cambia al vuelo con cada movimiento.
- `LEARNED` rellena un comercio sin categoría y reemplaza una `KEYWORD`.
- `KEYWORD` solo se asigna al crear el comercio sin categoría y sin movimiento que la traiga, con una categoría que ya existe y es visible para el usuario (nunca se crean categorías). La lista vive en `merchants/domain/merchant-category-keywords.ts` y se amplía por PR. Los nombres ambiguos («Google») no se categorizan solos.
- `PATCH /finance/merchants/:id` con `categoryId` fija `MANUAL`, incluso si es el mismo que ya tenía (así se confirma). `categoryId: null` borra la categoría y su origen.
- `GET /finance/merchants/suggest` devuelve `categoryId` y `categorySource`; la web solo la aplica al movimiento si su tipo (gasto o ingreso) coincide.
- La importación por correo usa la categoría del comercio antes del historial por texto crudo: primero la pista de la IA, luego el comercio, luego el historial (`source: 'merchant'`).
- Los movimientos ya guardados no se tocan.

Evidencia: `merchants/application/merchants.service.ts`, `merchants/domain/merchant-category-*.ts`, `shared/domain/category-type.ts` y sus specs.
