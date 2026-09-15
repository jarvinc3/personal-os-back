# Variables de entorno

Tabla canónica: [../infrastructure/config.md](../infrastructure/config.md). Copiar `.env.example` → `.env`.

Notas operativas:

- `GOOGLE_REDIRECT_URI` en el ejemplo: `http://localhost:3100/api/finance/email-sync/oauth/google/callback`
- `CORS_ORIGIN` debe incluir el origin de `personal-os-web` (`http://localhost:3000` en el ejemplo)
- Production: `REDIS_URL` + `OAUTH_STATE_SECRET` obligatorios
