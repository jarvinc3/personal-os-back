# Logos

Resuelve y almacena logos de instituciones, comercios y redes de tarjeta, con Logo.dev como fuente de marcas.

## Código

`packages/logos/src/`:

- `presentation/logos.controller.ts` — búsqueda de marcas (`GET /api/brands/search`), protegida por `@RequiresEnabledModule('finance')` y con throttle de 20/min.
- `application/logo.service.ts` — caché en memoria, resolución de URL, reglas de subida y precalentamiento de redes.
- `application/ports/` — `LogoStoragePort` (bucket) y `BrandLogoPort` (logo.dev).
- `infrastructure/supabase-logo.storage.ts` y `logo-dev.brand.client.ts` — adaptadores.
- `domain/` — normalización de dominio y dominios de redes de tarjeta.

## Llaves y entorno

| Llave      | Prefijo | Uso                                                       | Dónde vive                                     |
| ---------- | ------- | --------------------------------------------------------- | ---------------------------------------------- |
| Publicable | `pk_`   | `img.logo.dev` (parámetro `token`)                        | Backend y, opcionalmente, front (vista previa) |
| Secreta    | `sk_`   | `api.logo.dev` (búsqueda), header `Authorization: Bearer` | **Solo backend**                               |

`LOGO_DEV_SECRET_KEY` y `LOGO_DEV_PUBLISHABLE_KEY` son opcionales en `packages/config/src/env.schema.ts`. Sin la secreta, `search` devuelve `[]`; sin storage configurado, `ensureLogo` devuelve `null`. La `sk_` nunca debe llegar al front, al repositorio ni a los logs.

```env
# Backend (NestJS)
LOGO_DEV_SECRET_KEY=sk_...
LOGO_DEV_PUBLISHABLE_KEY=pk_...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...        # solo backend

# Frontend (Next.js)
NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY=pk_...   # solo para vista previa en el buscador
```

## Storage (Supabase)

- Bucket **público** `logos` (los logos de marca no son sensibles).
- Rutas: `brands/{domain}.png` (compartido entre usuarios y módulos) y `custom/{userId}/{entityId}.{ext}` (subidas manuales).
- Las escrituras las hace **solo el backend** con la service role key. No hay políticas de escritura para clientes.
- `brands/*` se sube con `cacheControl: '31536000'` (un año) para que navegador y CDN lo cacheen; `custom/*` con `'3600'`.
- Subidas manuales: PNG, JPG o WEBP, máximo 1 MB. **No se admite SVG**: puede contener scripts.

## Flujo

1. El usuario busca una marca. `GET /api/brands/search?q=` → `api.logo.dev` con la `sk_` (hasta 10 resultados; si falla o no hay llave, `[]`).
2. El front muestra los candidatos; la vista previa puede usar `https://img.logo.dev/{domain}?token=PK&size=64`.
3. Al guardar, `LogoService.ensureLogo(domain)` reutiliza `brands/{domain}.png` si existe o lo descarga de `img.logo.dev` con `fallback=404` y lo sube. Sin logo (404), la ruta queda nula y el front usa iniciales.
4. `resolveUrl` prioriza el logo propio (`customLogoPath`), luego el compartido (`logoPath`) y por último una URL legada (`logoUrl`).
5. Las redes de tarjeta (`visa.com`, `mastercard.com`, `americanexpress.com`, `discover.com`) se precalientan en `onApplicationBootstrap`; `networkLogoUrl` es síncrono y solo responde con caché.

## Casos borde

| Caso                                | Comportamiento                                                             |
| ----------------------------------- | -------------------------------------------------------------------------- |
| Sin resultados en la búsqueda       | Permitir dominio manual o subida propia                                    |
| `img.logo.dev` responde 404         | No se guarda archivo; ruta nula; iniciales en el front                     |
| Falla de red / timeout              | `ensureLogo` devuelve `null`; el alta no se bloquea                        |
| Dos usuarios suben el mismo dominio | El `upload` con `upsert: false` trata “ya existe” como éxito               |
| Logo desactualizado                 | Sobrescribir `brands/{domain}.png` (script admin); se actualiza para todos |
| Usuario sube logo propio            | `customLogoPath` tiene prioridad y no afecta al archivo compartido         |

## Consumidores

`finance` (catálogo, ledger y papelera) vía `LogoService`. `resolveUrl` también resuelve la marca del snapshot en la papelera.

## Enlaces

- Documentación oficial: <https://www.logo.dev/docs/introduction>
- Reportar logos incorrectos: <https://www.logo.dev/update>
