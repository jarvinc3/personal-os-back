# Configuración

Fuente: [`packages/config/src/env.schema.ts`](../../packages/config/src/env.schema.ts). Validación al boot (Zod).

## Claves

| Variable                                                                 | Regla                                                                                   |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                           | Requerida                                                                               |
| `SUPABASE_URL`                                                           | URL                                                                                     |
| `SUPABASE_SERVICE_ROLE_KEY`                                              | Requerida                                                                               |
| `GROQ_API_KEY` / `OPENROUTER_API_KEY`                                    | Al menos una, salvo `NODE_ENV=test`                                                     |
| `MAX_EMAIL_LLM_EXTRACTS` / `AI_DAILY_INSIGHT_QUOTA`                      | Enteros > 0; defaults 25 y 20                                                           |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`      | Requeridas (Gmail OAuth)                                                                |
| `ENCRYPTION_KEY`                                                         | ≥32; solo tokens OAuth de Gmail                                                         |
| `DATA_ENCRYPTION_KEY`                                                    | ≥32; cifra números de cuenta en reposo (distinta de `ENCRYPTION_KEY`)                   |
| `OAUTH_STATE_SECRET`                                                     | ≥32; **obligatoria en production**                                                      |
| `NODE_ENV`                                                               | `development` \| `production` \| `test` (default `development`)                         |
| `PORT`                                                                   | Default **3100** en schema y `.env.example`                                             |
| `CORS_ORIGIN`                                                            | URLs CSV                                                                                |
| `PUBLIC_WEB_URL`                                                         | URL opcional; base de los links `/c/<token>`. Sin valor, primer origin de `CORS_ORIGIN` |
| `REDIS_URL`                                                              | URL; **obligatoria en production**                                                      |
| `REDIS_ENABLED`                                                          | true solo con `true`/`1`                                                                |
| `BULL_BOARD_USER` / `BULL_BOARD_PASSWORD`                                | Ambas o ninguna                                                                         |
| `DATABASE_SSL_REJECT_UNAUTHORIZED`                                       | `true`/`false`/`1`/`0` only; pool Nest/pg, no Prisma CLI                                |
| `DATABASE_SSL_CA`                                                        | PEM opcional                                                                            |
| `API_PREFIX`                                                             | Default `api`                                                                           |
| `SWAGGER_PATH`                                                           | Default `docs`                                                                          |
| `BASE_CURRENCY`                                                          | ISO 3 letras, default `DOP`                                                             |
| `EXCHANGE_RATE_HOST_API_KEY`                                             | Opcional                                                                                |
| `SENTRY_DSN` / `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT`     | Opcionales; sin `SENTRY_DSN` la SDK no se inicializa                                    |
| `SENTRY_TRACES_SAMPLE_RATE`                                              | 0..1, default 0.1                                                                       |
| `EXPO_ACCESS_TOKEN`                                                      | Push Expo (cliente nativo; el web usa VAPID)                                            |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | Opcionales; las tres juntas habilitan el push Android (FCM)                             |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`               | Web Push                                                                                |
| `EMAIL_DELIVERY_ENABLED`                                                 | Default false; si true exige `RESEND_API_KEY` + `MAIL_FROM`                             |
| `RESEND_API_KEY` / `MAIL_FROM`                                           | Condicionales                                                                           |

**Auth:** JWT vía JWKS. No usar `SUPABASE_JWT_SECRET`.

**FCM:** la credencial se arma con `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` y `FIREBASE_PRIVATE_KEY`; la clave acepta saltos de línea reales o `\n` literales. Si falta alguna, el canal push queda apagado y el arranque sigue; los logs solo nombran la variable faltante, nunca su valor.

**Redis en development:** BullMQ solo si `REDIS_ENABLED=true` y `REDIS_URL`.

**TLS:** `PrismaService` aplica rejectUnauthorized/CA; Prisma CLI usa `DATABASE_URL`/`sslmode`.

## Evidencia

- Schema: `packages/config/src/env.schema.ts`
- Tests: `packages/config/src/env.schema.spec.ts`
- Ejemplo: `.env.example`
