# Health

Controlador: `src/health/health.controller.ts`. Prefijo global `API_PREFIX` → rutas `/api/health*`. Todas `@Public()`.

| Método | Path | Comportamiento |
| --- | --- | --- |
| GET | `/api/health` | Liveness: `{ status: 'ok', timestamp }` sin dependencias |
| GET | `/api/health/startup` | DB + JWKS + Redis si enabled; respuesta sanitizada |
| GET | `/api/health/ready` | Igual que startup (readiness para probes) |

Respuesta OK (envelope + payload sanitizado, runtime 2026-09-15):

```json
{
  "data": { "status": "ok", "timestamp": "ISO-8601" },
  "meta": { "timestamp": "ISO-8601", "path": "/api/health", "requestId": "uuid" }
}
```

Redis solo se pinguea si `RedisHealthIndicator.isEnabled()`.

## Criterios

- `AC-CORE-001` — Given servicio vivo, When `GET /api/health`, Then 200 y `status=ok`.
- `AC-CORE-002` — Given DB caída, When `GET /api/health/ready`, Then 503 genérico.

## Evidencia

- `src/health/health.controller.ts`, `health.controller.spec.ts`
- Indicators: `src/health/indicators/redis.health.indicator.ts`
