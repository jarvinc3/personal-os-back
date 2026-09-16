# Envelope y errores

## Éxito

`TransformInterceptor` envuelve JSON en:

```json
{
  "data": {},
  "meta": {
    "timestamp": "ISO-8601",
    "path": "/users/me",
    "requestId": "optional"
  }
}
```

Evidencia: `src/core/interceptors/transform.interceptor.ts`.

Health probes pasan por el mismo interceptor: el cuerpo útil sanitizado `{ status, timestamp }` queda en `data` (verificado en runtime 2026-09-15 contra `GET /api/health`, `/ready`, `/startup`).

## Errores

`AllExceptionsFilter` + `toErrorField` (`http-error.util.ts`). En production, 500 no filtra stack al cliente.

Errores de dominio Nest típicos: `statusCode`, `message`, `path`. 409 de catálogo finance pueden incluir `details.dependents` o `details.debitCardIds`.

Módulo finance deshabilitado: **403** `Finance module is disabled` (no 404).
