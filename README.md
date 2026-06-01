# Personal OS — Backend

API NestJS para **Personal OS**: auth con Supabase, usuarios, notificaciones, agente IA y núcleo transversal (guards, eventos, colas, WebSocket, health checks readiness/liveness).

Documentación detallada del core: [docs/core-infrastructure.md](./docs/core-infrastructure.md).

## Requisitos

- Node.js 20+
- pnpm
- PostgreSQL (Supabase)
- Proyecto Supabase con Auth habilitado
- Redis (opcional en local; recomendado Railway en prod)
- Al menos una API key: `GROQ_API_KEY`, `CEREBRAS_API_KEY` o `OPENROUTER_API_KEY`.

## Inicio rápido

```bash
cd personal-os-back
cp .env.example .env
# Editar .env con tus credenciales

pnpm install
pnpm db:generate
pnpm start:dev
```

- API: `http://localhost:3100/api` (según `PORT` y `API_PREFIX`)
- Swagger: `http://localhost:3100/docs`

## Variables de entorno

Copia `.env.example` a `.env`. Las más importantes:

| Variable                    | Uso                                                |
| --------------------------- | -------------------------------------------------- |
| `DATABASE_URL`              | Postgres (Supabase)                                |
| `SUPABASE_URL`              | URL del proyecto                                   |
| `SUPABASE_ANON_KEY`         | Cliente / Postman                                  |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo servidor                                      |
| `REDIS_URL`                 | BullMQ; en local usa `REDIS_PUBLIC_URL` de Railway |
| `REDIS_ENABLED`             | `true` en dev para activar colas                   |
| `GROQ_API_KEY` / …          | Proveedores IA                                     |

**Auth:** el backend valida JWT con **JWKS** (Signing Keys). No uses `SUPABASE_JWT_SECRET`.

**Redis en development:** BullMQ solo arranca si `REDIS_ENABLED=true` y `REDIS_URL` están definidos. Sin Redis, el resto de la API funciona igual.

## Scripts

| Comando           | Descripción                      |
| ----------------- | -------------------------------- |
| `pnpm start:dev`  | Desarrollo con hot reload        |
| `pnpm build`      | Compilar                         |
| `pnpm lint`       | ESLint                           |
| `pnpm test:e2e`   | Tests e2e (health, auth y users) |
| `pnpm db:migrate` | Migraciones Prisma               |
| `pnpm db:studio`  | Prisma Studio                    |

## Postman

1. Import → `postman.json`
2. Import → `postman.environment.json` (entorno **Personal OS — Local**)
3. Configurar `supabaseUrl`, `supabaseAnonKey`, `supabaseEmail`, `supabasePassword`
4. Ejecutar **Supabase Auth → Sign in (password)** → guarda `accessToken` automáticamente
5. Probar carpetas **Auth**, **Users**, **Notifications**, **AI Agent** (sesiones + chat)

## Endpoints principales

| Método | Ruta                                               | Auth | Descripción                                  |
| ------ | -------------------------------------------------- | ---- | -------------------------------------------- |
| GET    | `/api/health`                                      | No   | Liveness                                     |
| GET    | `/api/health/ready`                                | No   | Readiness (DB + JWKS + Redis opcional)       |
| GET    | `/api/auth/session`                                | Sí   | Sesión actual                                |
| GET    | `/api/users/me`                                    | Sí   | Perfil                                       |
| PATCH  | `/api/users/me`                                    | Sí   | Actualizar perfil                            |
| DELETE | `/api/users/me`                                    | Sí   | Eliminar cuenta y datos asociados            |
| PATCH  | `/api/users/me/modules/:slug`                      | Sí   | Actualizar config de módulo (`user_modules`) |
| GET    | `/api/notifications`                               | Sí   | Listar notificaciones (paginado)             |
| GET    | `/api/notifications/unread-count`                  | Sí   | Contador IN_APP no leídas                    |
| PATCH  | `/api/notifications/read-all`                      | Sí   | Marcar todas IN_APP como leídas              |
| POST   | `/api/notifications`                               | Sí   | Crear notificación (usuario autenticado)     |
| PATCH  | `/api/notifications/:id/read`                      | Sí   | Marcar leída                                 |
| POST   | `/api/notifications/push-tokens`                   | Sí   | Registrar push token                         |
| PATCH  | `/api/notifications/push-tokens/:token/deactivate` | Sí   | Desactivar push token                        |
| GET    | `/api/ai/providers`                                | Sí   | Proveedores IA                               |
| GET    | `/api/ai/sessions`                                 | Sí   | Listar sesiones de chat                      |
| POST   | `/api/ai/sessions`                                 | Sí   | Crear sesión                                 |
| GET    | `/api/ai/sessions/:id`                             | Sí   | Sesión con mensajes                          |
| DELETE | `/api/ai/sessions/:id`                             | Sí   | Eliminar sesión                              |
| POST   | `/api/ai/chat`                                     | Sí   | Chat (JSON, persistido)                      |
| POST   | `/api/ai/chat/stream`                              | Sí   | Chat (SSE)                                   |

Respuestas exitosas usan envelope `{ data, meta }`. Ver [docs/core-infrastructure.md](./docs/core-infrastructure.md).

## Background jobs (BullMQ)

Con `REDIS_ENABLED=true` y `REDIS_URL` válido, están activos:

- `notifications` queue → `NotificationsProcessor`
- `ai-processing` queue → `AiProcessingProcessor`
- `email-sync` queue → `EmailSyncProcessor` (stub para Gmail)

Si BullMQ está deshabilitado en development, las rutas siguen funcionando y los enqueues se omiten de forma segura.

## WebSocket

- Namespace: `/notifications`
- Auth: `Authorization: Bearer <token>` o `auth: { token: "<token>" }`
- Rooms: `user:{sub}`
- Eventos: `notification.new`, `ai.response`, `ping`

Usa un cliente **Socket.IO** (Postman no cubre bien el protocolo Socket.IO).

## Despliegue (Railway / similar)

- `NODE_ENV=production`
- `REDIS_URL` → URL **interna** (`redis.railway.internal`) si el API corre en Railway
- Resto de secrets en variables del servicio
- `pnpm build` + `pnpm start:prod`

## CI

Workflow incluido: [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)

Pasos:

1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. `pnpm build`
4. `pnpm test:e2e -- --runInBand`

## Estructura

```src
src/
  config/          # Env Zod, Supabase JWKS, Redis
  core/            # Guards, interceptors, filters, eventos, colas
  health/          # Liveness + readiness (Terminus)
  modules/
    auth/
    users/
    notifications/
    ai-agent/
  prisma/
docs/
  core-infrastructure.md
postman.json
postman.environment.json
```

## Licencia

UNLICENSED — uso privado del proyecto Personal OS.
