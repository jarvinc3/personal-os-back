# Variables de entorno

Tabla canónica: [../infrastructure/config.md](../infrastructure/config.md). Para desarrollo local, trae las variables con `pnpm env:pull` (ver abajo); `.env.example` documenta las claves sin valores reales.

Notas operativas:

- `GOOGLE_REDIRECT_URI` en el ejemplo: `http://localhost:3100/api/finance/email-sync/oauth/google/callback`
- `CORS_ORIGIN` debe incluir el origin de `personal-os-web` (`http://localhost:3000` en el ejemplo)
- `PUBLIC_WEB_URL` es la base de los links de cobros compartidos (`<PUBLIC_WEB_URL>/c/<token>`). En producción debe ser el dominio de la web; sin valor se usa el primer origin de `CORS_ORIGIN`
- Production: `REDIS_URL` + `OAUTH_STATE_SECRET` obligatorios
- Sentry es opcional: sin `SENTRY_DSN` no se inicializa; `SENTRY_AUTH_TOKEN` solo sirve para subir source maps y sin él el build no falla

## Variables de entorno y secretos

Infisical es la fuente de verdad: proyecto `personal-os`, entornos `dev` y `prod`, carpetas `/back` y `/web`. Railway (back) y Vercel (web) se llenan con sus Secret Syncs, así que no edites variables directo en esas plataformas: el siguiente sync sobrescribe el cambio.

El repo trae `.infisical.json` con el `workspaceId`. Con la CLI de Infisical instalada y la sesión iniciada:

```bash
infisical export --env=dev --path=/back > .env
# o el atajo
pnpm env:pull
```

`env:pull` reemplaza el `.env` local. No commitees ese archivo ni pongas valores reales en `.env.example`, documentación o tests.
