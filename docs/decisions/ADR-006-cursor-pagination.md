# ADR-006: Paginación por cursor en los endpoints de lista

- Estado: `accepted`
- Fecha: 2026-10-11

## Contexto

Los endpoints de lista paginan por página: `PaginationQueryDto` (`page`, `limit`) y `paginate()` en `packages/core/src/pagination/` devuelven `{ items, pagination: { page, limit, total, totalPages } }`. Lo usan movimientos (`ListTransactionsQueryDto`), presupuestos, notificaciones y sesiones de IA.

La web necesita scroll infinito: cargar la siguiente tanda al bajar, sin botones de página. La paginación por página obliga a un `count` extra para calcular `total`, y con offset (`skip`) una fila insertada mientras el usuario baja desplaza la ventana y repite o salta registros.

## Decisión

- Reemplazar `page` por `cursor` en los endpoints paginados. La query queda `cursor` (opcional) + `limit`.
- La respuesta pasa a `{ items, nextCursor, hasMore }`. Se elimina `total` y `totalPages`, y con ellos la consulta de conteo.
- El cursor es **opaco** para el cliente: un valor codificado (base64) de la clave de orden y el id de la última fila. El cliente solo lo reenvía.
- El orden de cada lista es estable y con desempate por id; el cursor codifica exactamente esa clave.
- La primera tanda no manda `cursor`. `nextCursor` nulo (o `hasMore` falso) marca el final.

## Alternativas

- **Reusar offset con `useInfiniteQuery`**: no cambia el API, pero repite o salta filas cuando entran registros nuevos mientras el usuario baja.
- **Mantener `total` junto al cursor**: conserva el conteo para mostrar "cuántos hay", a costa de un `count` por tanda y de mantener un dato que el scroll infinito no usa.
- **Cursor solo en el cliente (sobre offset)**: no resuelve el desorden; es la misma paginación por página con otro nombre.

## Consecuencias

Cambia un contrato compartido (`packages/core`) y los cuatro endpoints que lo usan; la web actualiza sus tipos y hooks. Los contratos HTTP documentados (`docs/modules/finance/contracts/http.md`, `docs/modules/notifications/contracts/http.md`) se actualizan cuando se implemente, no antes. Migración pendiente; mientras tanto el runtime sigue con `page` / `limit`. Decisión espejo en `personal-os-web/docs/decisions/ADR-003-cursor-pagination.md`.
