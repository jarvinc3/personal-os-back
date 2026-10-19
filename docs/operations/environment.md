# Variables de entorno

Tabla canónica: [../infrastructure/config.md](../infrastructure/config.md). Copiar `.env.example` → `.env`.

Notas operativas:

- `GOOGLE_REDIRECT_URI` en el ejemplo: `http://localhost:3100/api/finance/email-sync/oauth/google/callback`
- `CORS_ORIGIN` debe incluir el origin de `personal-os-web` (`http://localhost:3000` en el ejemplo)
- `PUBLIC_WEB_URL` es la base de los links de cobros compartidos (`<PUBLIC_WEB_URL>/c/<token>`). En producción debe ser el dominio de la web; sin valor se usa el primer origin de `CORS_ORIGIN`
- Production: `REDIS_URL` + `OAUTH_STATE_SECRET` obligatorios
- Sentry es opcional: sin `SENTRY_DSN` no se inicializa; `SENTRY_AUTH_TOKEN` solo sirve para subir source maps y sin él el build no falla
