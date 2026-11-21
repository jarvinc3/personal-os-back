# Seguridad (production)

Checklist verificable en `main.ts` + guards:

- Swagger off cuando `NODE_ENV=production`
- Bull Board off (path `/admin/queues` no montado)
- Helmet + `trust proxy`
- Body limit 1mb
- 500 genéricos al cliente (`AllExceptionsFilter`)
- WS CORS = `CORS_ORIGIN`; en non-prod también `CORS_ORIGIN_PATTERNS` (previews de rama)
- CORS REST = `CORS_ORIGIN`; en non-prod también `CORS_ORIGIN_PATTERNS`. Un origen no permitido responde sin cabeceras CORS (sin 500) y una petición sin `Origin` (navegación directa a Swagger, curl) pasa sin cabeceras CORS
- `/api/health` y `/api/health/ready` (y `/startup`) públicos; ready/startup sanitizan el contrato
- Separar `OAUTH_STATE_SECRET` de `AI_GMAIL_TOKEN_ENCRYPTION_KEY` (el schema exige state en producción y con Gmail configurado)
- JWT vía JWKS, no `SUPABASE_JWT_SECRET`
- Gmail: tokens cifrados con `AI_GMAIL_TOKEN_ENCRYPTION_KEY`; scope read-only; state HMAC con `OAUTH_STATE_SECRET`
- Cuentas: número cifrado con `DATA_ENCRYPTION_KEY` (AES-256-GCM) + hash HMAC para unicidad; la API solo expone `accountNumberLast4`. Ambas claves son independientes: rotar una no afecta a la otra.
- Finance REST y tools: `EnabledModuleGuard` / `assertModuleEnabled`

Límites de chat: throttle + `@Timeout(30000)` en `POST /ai/chat` y stream.
