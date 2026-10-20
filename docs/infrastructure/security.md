# Seguridad (production)

Checklist verificable en `main.ts` + guards:

- Swagger off cuando `NODE_ENV=production`
- Bull Board off (path `/admin/queues` no montado)
- Helmet + `trust proxy`
- Body limit 1mb
- 500 genéricos al cliente (`AllExceptionsFilter`)
- WS CORS = `CORS_ORIGIN`
- `/api/health` y `/api/health/ready` (y `/startup`) públicos; ready/startup sanitizan el contrato
- Separar `OAUTH_STATE_SECRET` de `ENCRYPTION_KEY` (schema exige OAuth secret en prod)
- JWT vía JWKS, no `SUPABASE_JWT_SECRET`
- Gmail: tokens cifrados con `ENCRYPTION_KEY`; scope read-only; state JWT
- Cuentas: número cifrado con `DATA_ENCRYPTION_KEY` (AES-256-GCM) + hash HMAC para unicidad; la API solo expone `accountNumberLast4`. Ambas claves son independientes: rotar una no afecta a la otra.
- Finance REST y tools: `EnabledModuleGuard` / `assertModuleEnabled`

Límites de chat: throttle + `@Timeout(30000)` en `POST /ai/chat` y stream.
