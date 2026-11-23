# Health

Controlador: `apps/api/src/health/health.controller.ts`. Prefijo global `API_PREFIX` → rutas `/api/health*`. Todas `@Public()`.

| Método | Path                  | Comportamiento                                                  |
| ------ | --------------------- | --------------------------------------------------------------- |
| GET    | `/api/health`         | Liveness: `{ status: 'ok', timestamp }` sin dependencias        |
| GET    | `/api/health/startup` | DB + JWKS + Redis si enabled; respuesta sanitizada              |
| GET    | `/api/health/ready`   | DB + Redis si enabled; no consulta JWKS (readiness para probes) |

Respuesta OK (envelope + payload sanitizado, runtime 2026-09-15):

```json
{
  "data": { "status": "ok", "timestamp": "ISO-8601" },
  "meta": {
    "timestamp": "ISO-8601",
    "path": "/api/health",
    "requestId": "uuid"
  }
}
```

Redis solo se pinguea si `RedisHealthIndicator.isEnabled()`.

JWKS solo entra en el startup: el readiness no depende de un tercero y el orquestador recibe su 503 por la base o Redis. El ping a JWKS usa `timeout` de 2 s, así que una sonda no deja la conexión abierta, y reutiliza un resultado correcto durante 60 s para que la ruta pública anónima no amplifique tráfico hacia el proveedor. Un fallo no se cachea: la siguiente sonda reintenta en cuanto el proveedor responde.

## Criterios

- `AC-CORE-001` — Given servicio vivo, When `GET /api/health`, Then 200 y `status=ok`.
- `AC-CORE-002` — Given DB caída, When `GET /api/health/ready`, Then 503 genérico.

## Evidencia

- `apps/api/src/health/health.controller.ts`, `health.controller.spec.ts`
- Sondas: `apps/api/src/health/probes/jwks.probe.ts`, `readiness-indicators.ts`, `health-check-runner.ts`
- Indicators: `apps/api/src/health/indicators/redis.health.indicator.ts`
