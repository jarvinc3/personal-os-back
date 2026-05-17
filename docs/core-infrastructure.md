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

| Pieza                   | Descripción                                           |
| ----------------------- | ----------------------------------------------------- |
| `JwtAuthGuard`          | Guard global; rutas con `@Public()` quedan libres     |
| `RolesGuard`            | Autorización por roles (`@Roles()`)                   |
| `CustomThrottlerGuard`  | Rate limit por `user.sub` o IP                        |
| `TransformInterceptor`  | Respuesta `{ data, meta }`                            |
| `LoggingInterceptor`    | Logs estructurados por request                        |
| `TimeoutInterceptor`    | Timeout global de requests                            |
| `AllExceptionsFilter`   | Errores uniformes + mapeo Prisma P2002/P2025          |
| `AiMetricsInterceptor`  | Métricas en rutas `/api/ai` (si hay `sessionId`)      |
| `event.constants.ts`    | Catálogo de eventos de dominio                        |
| `domain-events.ts`      | Tipos de payloads                                     |
| `queue.constants.ts`    | Colas: `email-sync`, `ai-processing`, `notifications` |
| `queue-jobs.ts`         | Tipos de payload para jobs BullMQ                     |
| `pagination.dto.ts`     | DTO + helpers `paginationArgs()` y `paginate()`       |
| `pagination.service.ts` | Servicio exportado desde `CoreModule`                 |

### Auth (`src/modules/auth/`)

- **Supabase JWT** con JWKS (`passport-jwt` + `jwks-rsa`).
- `SupabaseJwtVerifierService` para WebSocket.
- `GET /api/auth/session` — contexto del usuario autenticado; emite `user.logged_in`.
- `GET /api/health` — liveness público.
- `GET /api/health/ready` — readiness con checks de DB, JWKS y Redis opcional.
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
- Worker `NotificationsProcessor` (cola `notifications`) para dispatch async (`IN_APP`, `PUSH`, `EMAIL`).
- Worker `EmailSyncProcessor` (cola `email-sync`) como stub para integración Gmail.

### AI Agent (`src/modules/ai-agent/`)

- Pool de proveedores: Groq, Cerebras, OpenRouter (según keys en `.env`).
- Round-robin y failover entre proveedores.
- `GET /api/ai/providers`
- `POST /api/ai/chat` — respuesta JSON agregada.
- `POST /api/ai/chat/stream` — SSE (`start` → `chunk`* → `done` / `error`).
- Listeners `@OnEvent` para `transaction.created`, `budget.threshold_reached`, `ai.action_requested` que encolan jobs en `ai-processing`.
- Worker `AiProcessingProcessor` (cola `ai-processing`) para ejecutar acciones IA async y emitir `ai.response`.
- Throttling más estricto en rutas `/api/ai`.

### App (`src/app.module.ts`)

- BullMQ solo si `isBullMqEnabled()` (Redis + flag en dev).
- Cache global, `ScheduleModule`, CLS, EventEmitter.
- Logger pino con `forRoutes` explícito para evitar warning de `LegacyRouteConverter`.

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

### Envelope paginado

```json
{
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 125,
      "totalPages": 7
    }
  },
  "meta": {
    "timestamp": "2026-05-17T...",
    "path": "/api/...",
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

```http
GET http://localhost:3100/api/health/ready
```

Esperado: `200`, `data.status === "ok"`, `data.info.database.status === "up"`, `data.info.jwks.status === "up"`.

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

Con `REDIS_ENABLED=true` y `REDIS_URL` válido: arranque sin `ECONNREFUSED`.

Verificar workers:

- `notifications` procesa jobs creados por `POST /api/notifications`.
- `notifications` delega `EMAIL` a `email-sync`.
- `ai-processing` procesa eventos `ai.action_requested`.

#### 10. Swagger

Abrir `http://localhost:3100/docs` y probar **Authorize** con el mismo Bearer token.

### E2E incluidos

- `test/app.e2e-spec.ts` → `/api/health` (liveness).
- `test/auth.e2e-spec.ts` → `401` sin token, `200` con JWT válido, `401` expirado.
- `test/users.e2e-spec.ts` → `/api/users/me` (`200` y `404`) + `PATCH /api/users/me`.
- Helpers comunes:
  - `test/helpers/jwt.helper.ts`
  - `test/helpers/prisma.mock.ts`
  - `test/helpers/test-env.ts`

### CI (GitHub Actions)

- Workflow: `.github/workflows/ci.yml`
- Jobs: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm build`, `pnpm test:e2e -- --runInBand`
- Entorno: `NODE_ENV=test` con variables mínimas para bootstrap del `AppModule`

---

## Estado production-ready del core

### Completado en este ciclo

1. **Health compuesto** con Terminus (`/api/health` y `/api/health/ready`).
2. **Workers BullMQ** para `notifications`, `ai-processing`, `email-sync`.
3. **Paginación compartida** (`PaginationQueryDto`, `paginate`, `paginationArgs`, `PaginationService`).
4. **E2E ampliados** para auth y users con JWT de test y mock centralizado de Prisma.
5. **CI GitHub Actions** (`lint`, `build`, `test:e2e --runInBand`).
6. **Cleanup de logs** con `forRoutes` explícito en `LoggerModule`.

### Pendiente recomendado antes de módulos de dominio

1. **Push real provider** (FCM/APNs) y sender de email real (Gmail API).
2. **Tests de integración WS + workers** para flujo end-to-end de eventos async.
3. **Migrations Prisma y seeds de entorno** (pendiente externo a este plan).

---

## Referencias

- Colección Postman: `postman.json`
- Entorno local: `postman.environment.json`
- OpenAPI generado al arrancar: `swagger-spec.json`
- README del repo: `README.md`
