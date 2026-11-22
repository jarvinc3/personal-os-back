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

Evidencia: `packages/core/src/interceptors/transform.interceptor.ts`.

Health probes pasan por el mismo interceptor: el cuerpo útil sanitizado `{ status, timestamp }` queda en `data` (verificado en runtime 2026-09-15 contra `GET /api/health`, `/ready`, `/startup`).

## Errores

`AllExceptionsFilter` + `toErrorField` (`http-error.util.ts`). En production, 500 no filtra stack al cliente. Si la respuesta ya envió cabeceras —SSE del chat, exportación de datos o cualquier `@Res()`—, el filtro no intenta fijar estado ni cuerpo: registra el fallo en el mismo log y destruye la respuesta para cerrar el socket, igual que hace el controlador de exportación de Knowledge.

Errores de dominio Nest típicos: `statusCode`, `message`, `path`. 409 de catálogo finance pueden incluir `details.dependents` o `details.debitCardIds`.

Módulo finance deshabilitado: **403** `Finance module is disabled` (no 404).

## Idempotencia de mutaciones

`POST`, `PATCH` y `DELETE` aceptan `Idempotency-Key`. El interceptor guarda la respuesta y la repite mientras la clave viva (24 h).

- Misma clave + misma petición → repite la respuesta guardada, sin ejecutar el handler otra vez.
- Misma clave + otra ruta o cuerpo → **409**.
- Clave en curso → **409**.
- El handler falla → la clave se libera y el reintento puede correr.
- La petición agota el tiempo de espera de `TimeoutInterceptor` → la clave **no** se libera: el handler puede seguir corriendo y un reintento duplicaría el trabajo. `POST /api/intelligence/email/sample-import` es el caso: guarda el trabajo y lo encola en `ai-email-sample-import` antes de responder `202`, así que si la respuesta se corta el trabajo ya está encolado y repetir con la misma clave responde **409** en vez de encolar otro.

Las claves vencidas se borran a diario por lotes (`IdempotencyKeyRetentionScheduler`, 03:00).

Evidencia: `packages/core/src/interceptors/idempotency.interceptor.ts`, `packages/core/src/maintenance/idempotency-key-retention.scheduler.ts`.
