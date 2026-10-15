# ADR-007: Sin prefijo de versión en la API (`/v1`)

- Estado: `accepted`
- Fecha: 2026-10-15

## Contexto

El back es un monorepo Nest con un solo cliente real: el cliente web `personal-os-web`. Web y back se despliegan juntos, y el contrato HTTP se acuerda entre ambos repos en el mismo ciclo de release. `personal-os-app` (Expo) está fuera de servicio.

## Decisión

- No se agrega prefijo de versión a las rutas (`/v1`, `/v2`). Las rutas siguen siendo `/api/<recurso>`.
- Un cambio incompatible en beta sube MINOR y se anota en el CHANGELOG; en `0.x` romper compatibilidad es parte del contrato.
- La decisión se revisa cuando aparezca un cliente externo que no se despliegue con el back, o si la app móvil vuelve a estar en servicio. En ese momento se evalúa versionar.

## Alternativas

- **`/v1` desde ahora**: obliga a mantener dos versiones por cada cambio incompatible; con un solo cliente que se despliega junto no hay consumidor que se quede atrás.
- **Versionado por cabecera (`Accept` o cabecera propia)**: mismo costo de mantenimiento con más superficie que documentar.

## Consecuencias

La web no cambia sus constantes de endpoint. Si un contrato cambia, ambos repos se actualizan en el mismo release y las pruebas obligatorias de los dos lo verifican.
