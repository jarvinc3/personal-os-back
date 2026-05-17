# Core infrastructure — Personal OS Backend

Estado del núcleo transversal del backend (`personal-os-back`) antes de implementar módulos de dominio (finanzas, agenda, etc.).

## Stack

| Capa        | Tecnología                                |
| ----------- | ----------------------------------------- |
| Framework   | NestJS 11                                 |
| ORM         | Prisma 7 + PostgreSQL (Supabase)          |
| Auth        | Supabase Auth (JWT vía JWKS, RS256/ES256) |
| Colas       | BullMQ + Redis (opcional en dev)          |
| Eventos     | `@nestjs/event-emitter` (in-process)      |
| Logs        | Pino (`nestjs-pino`)                      |
| API docs    | Swagger (`/docs`)                         |
| Tiempo real | Socket.IO (`/notifications`)              |

---

## Lo implementado

### Configuración (`src/config/`)

- Validación de entorno con **Zod** (`env.schema.ts`).
- Supabase: `SUPABASE_URL`, issuer y JWKS derivados automáticamente.
- Redis: `REDIS_URL` opcional en development; obligatorio en production.
- `REDIS_ENABLED=true` requerido en development para activar BullMQ.
- Al menos una API key de IA en entornos no-test.

### Core transversal (`src/core/`)

| Pieza                  | Descripción                                           |
| ---------------------- | ----------------------------------------------------- |
| `JwtAuthGuard`         | Guard global; rutas con `@Public()` quedan libres     |
| `RolesGuard`           | Autorización por roles (`@Roles()`)                   |
| `CustomThrottlerGuard` | Rate limit por `user.sub` o IP                        |
| `TransformInterceptor` | Respuesta `{ data, meta }`                            |
| `LoggingInterceptor`   | Logs estructurados por request                        |
| `TimeoutInterceptor`   | Timeout global de requests                            |
| `AllExceptionsFilter`  | Errores uniformes + mapeo Prisma P2002/P2025          |
| `AiMetricsInterceptor` | Métricas en rutas `/api/ai` (si hay `sessionId`)      |
| `event.constants.ts`   | Catálogo de eventos de dominio                        |
| `domain-events.ts`     | Tipos de payloads                                     |
| `queue.constants.ts`   | Colas: `email-sync`, `ai-processing`, `notifications` |

### Auth (`src/modules/auth/`)

- **Supabase JWT** con JWKS (`passport-jwt` + `jwks-rsa`).
- `SupabaseJwtVerifierService` para WebSocket.
- `GET /api/auth/session` — contexto del usuario autenticado; emite `user.logged_in`.
- `GET /api/health` — liveness público.
- Perfil en `public.users` vía trigger de Supabase (sin upsert lazy en backend).

### Users (`src/modules/users/`)

- `GET /api/users/me` — perfil del usuario autenticado.
- `PATCH /api/users/me` — actualizar `fullName`, `timezone`, `locale`, `avatarUrl`, `preferences`.

### Notifications (`src/modules/notifications/`)

- `POST /api/notifications` — crear notificación y emitir por WebSocket.
- `PATCH /api/notifications/:id/read` — marcar como leída.
- `POST /api/notifications/push-tokens` — registrar token push (ios/android).
- `PATCH /api/notifications/push-tokens/:token/deactivate` — desactivar token.
- **WebSocket** namespace `/notifications`, room `user:{sub}`, eventos `notification.new`, `ai.response`, handler `ping`.

### AI Agent (`src/modules/ai-agent/`)

- Pool de proveedores: Groq, Cerebras, OpenRouter (según keys en `.env`).
- Round-robin y failover entre proveedores.
- `GET /api/ai/providers`
- `POST /api/ai/chat` — respuesta JSON agregada.
- `POST /api/ai/chat/stream` — SSE (`start` → `chunk`* → `done` / `error`).
- Listeners `@OnEvent` para `transaction.created`, `budget.threshold_reached`, `ai.action_requested` (stubs de log).
- Throttling más estricto en rutas `/api/ai`.

### App (`src/app.module.ts`)

- BullMQ solo si `isBullMqEnabled()` (Redis + flag en dev).
- Cache global, `ScheduleModule`, CLS, EventEmitter.

---

## Contrato de API

### Envelope de éxito

```json
{
  "data": { },
  "meta": {
    "timestamp": "2026-05-17T...",
    "path": "/api/users/me",
    "requestId": "uuid"
  }
}
```

### Envelope de error

```json
{
  "statusCode": 401,
  "error": "Unauthorized",
  "message": "...",
  "requestId": "uuid",
  "timestamp": "...",
  "path": "/api/..."
}
```

### Autenticación

Todas las rutas protegidas requieren:

```http
Authorization: Bearer <supabase_access_token>
```

El token se obtiene del cliente Supabase o vía Postman (carpeta **Supabase Auth** en la colección).

---

## Variables de entorno relevantes

Ver `.env.example`. Resumen:

| Variable                    | Descripción                                                        |
| --------------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`              | Postgres (Supabase)                                                |
| `SUPABASE_URL`              | URL del proyecto Supabase                                          |
| `SUPABASE_ANON_KEY`         | Anon key (Postman + cliente)                                       |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo backend, nunca en cliente                                     |
| `REDIS_URL`                 | Local: `REDIS_PUBLIC_URL` de Railway; prod en Railway: URL interna |
| `REDIS_ENABLED`             | `true` en dev para activar BullMQ                                  |
| `GROQ_API_KEY` / etc.       | Al menos una para IA                                               |

---

## Plan de pruebas (core)

### Automatizado

```bash
pnpm lint
pnpm build
pnpm test:e2e
```

### Manual — orden sugerido

#### 1. Health (sin auth)

```http
GET http://localhost:3100/api/health
```

Esperado: `200`, `data.status === "ok"`.

#### 2. Supabase login (Postman)

1. Importar `postman.json` + `postman.environment.json`.
2. Rellenar `supabaseUrl`, `supabaseAnonKey`, `supabaseEmail`, `supabasePassword`.
3. Ejecutar **Supabase Auth → Sign in (password)**.
4. Verificar que `accessToken` se guardó en variables.

#### 3. Session

```http
GET /api/auth/session
Authorization: Bearer {{accessToken}}
```

Esperado: `data` con `sub`, `email`, `role`.

Sin token → `401`.

#### 4. Users

```http
GET  /api/users/me
PATCH /api/users/me
```

Requiere fila en `public.users` (trigger al registrarse en Supabase).

#### 5. Notifications REST

```http
POST /api/notifications
PATCH /api/notifications/:id/read
POST /api/notifications/push-tokens
```

#### 6. AI

```http
GET  /api/ai/providers
POST /api/ai/chat
POST /api/ai/chat/stream
```

Verificar headers `x-ratelimit-*` y respuesta envelope.

#### 7. Rate limiting

Muchas peticiones rápidas a una ruta protegida → `429` con cuerpo de error estándar.

#### 8. WebSocket (cliente Socket.IO)

Conectar a `http://localhost:3100/notifications` con token en `auth.token` o header `Authorization`.

- Emitir `ping` → respuesta con `userId`.
- Tras `POST /api/ai/chat` autenticado, escuchar `ai.response`.

#### 9. Redis / BullMQ (opcional)

Con `REDIS_ENABLED=true` y `REDIS_URL` válido: arranque sin `ECONNREFUSED`. Las colas están registradas; los **workers** aún no procesan jobs.

#### 10. Swagger

Abrir `http://localhost:3100/docs` y probar **Authorize** con el mismo Bearer token.

---

## Pendiente para dejar el core “production-ready”

### Prioridad alta

1. **Workers BullMQ** — processors para `email-sync`, `ai-processing`, `notifications`.
2. **Health compuesto** — checks de DB, Redis y JWKS en `GET /health`.
3. **E2E ampliados** — auth, envelope, 401, `users/me` con JWT de test.
4. **Prisma migrations** — resolver drift con Supabase (baseline / `migrate resolve`, sin reset destructivo en prod).

### Prioridad media

5. **Emitir eventos reales** desde servicios (no solo `user.logged_in`).
6. **Push providers** — FCM/APNs usando `PushTokensService` + cola `notifications`.
7. **Tests de integración WebSocket** — conexión + room + emit.
8. **Documentar RLS** — políticas Supabase alineadas con `sub` del JWT.

### Antes de módulos de aplicación

9. Contrato estable: paginación, filtros, códigos de error por dominio.
10. Observabilidad en prod: niveles Pino, alertas, métricas de colas.
11. CI: `lint` + `build` + `test:e2e` en cada PR.

---

## Referencias

- Colección Postman: `postman.json`
- Entorno local: `postman.environment.json`
- OpenAPI generado al arrancar: `swagger-spec.json`
- README del repo: `README.md`
