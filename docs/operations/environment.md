# Variables de entorno

Tabla canónica: [../infrastructure/config.md](../infrastructure/config.md). Para desarrollo local, trae las variables con `pnpm env:pull` (ver abajo); `.env.example` documenta las claves sin valores reales.

Notas operativas:

- `AI_GMAIL_REDIRECT_URI` en el ejemplo: `http://localhost:3100/api/intelligence/email/oauth/callback`; debe ser idéntica a la URI registrada en Google Cloud, si no el callback vuelve con `gmail=error`
- `CORS_ORIGIN` debe incluir el origin de `personal-os-web` (`http://localhost:3000` en el ejemplo)
- `CORS_ORIGIN_PATTERNS` acepta los previews de rama de Vercel en dev con patrones anclados, por ejemplo `^https://personal-os-web-git-[a-z0-9-]+-collado-studios\.vercel\.app$`; en production la variable no se acepta y `CORS_ORIGIN` sigue siendo la única fuente
- `PUBLIC_WEB_URL` es la base de los links de cobros compartidos (`<PUBLIC_WEB_URL>/c/<token>`). En producción debe ser el dominio de la web; sin valor se usa el primer origin de `CORS_ORIGIN`
- Production: `REDIS_URL` + `OAUTH_STATE_SECRET` obligatorios; `OAUTH_STATE_SECRET` también con Gmail configurado
- Production: `DATABASE_SSL_REJECT_UNAUTHORIZED=false` obligatorio. La cadena de certificados del pooler de Supabase no pasa la verificación estricta; quitar la variable tumbó prod el 2026-10-22. El arreglo correcto a futuro es cargar el CA de Supabase en `DATABASE_SSL_CA` y volver a `true`
- Sentry es opcional: sin `SENTRY_DSN` no se inicializa; `SENTRY_AUTH_TOKEN` solo sirve para subir source maps y sin él el build no falla

## Variables de entorno y secretos

Infisical es la fuente de verdad: proyecto `personal-os`, entornos `dev` y `prod`, carpetas `/back` y `/web`. Railway (back) y Vercel (web) se llenan con sus Secret Syncs, así que no edites variables directo en esas plataformas. Los syncs tienen activado el borrado: cualquier variable de Railway o Vercel que no exista en Infisical se elimina en el siguiente sync, y los cambios manuales se sobrescriben. Las variables nuevas se agregan solo en Infisical.

El repo trae `.infisical.json` con el `workspaceId`. Con la CLI de Infisical instalada y la sesión iniciada:

```bash
infisical export --env=dev --path=/back > .env
# o el atajo
pnpm env:pull
```

`env:pull` reemplaza el `.env` local. No commitees ese archivo ni pongas valores reales en `.env.example`, documentación o tests.
