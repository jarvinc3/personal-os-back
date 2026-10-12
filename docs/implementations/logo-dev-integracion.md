# Integración de Logo.dev

Uso de Logo.dev para asignar logos a **instituciones bancarias** (`fin_institutions`) y **suscripciones** (`sub_subscriptions`).

Documentación oficial: <https://www.logo.dev/docs/introduction>

## 1. Llaves

| Llave      | Prefijo | Dónde se usa                                              | Dónde vive                                     |
| ---------- | ------- | --------------------------------------------------------- | ---------------------------------------------- |
| Publicable | `pk_`   | `img.logo.dev` (parámetro `token`)                        | Backend y, opcionalmente, front (vista previa) |
| Secreta    | `sk_`   | `api.logo.dev` (búsqueda), header `Authorization: Bearer` | **Solo backend**                               |

La `sk_` nunca debe llegar al front, al repositorio ni a los logs.

Variables de entorno:

```env
# Backend (NestJS)
LOGO_DEV_SECRET_KEY=sk_...
LOGO_DEV_PUBLISHABLE_KEY=pk_...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...        # solo backend

# Frontend (Next.js)
NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY=pk_...   # solo para vista previa en el buscador
```

## 2. Flujo completo

1. El usuario escribe "netflix" en el buscador (con debounce).
2. **Front → tu backend:** `GET /brands/search?q=netflix`.
3. **Backend → Logo.dev:** `GET https://api.logo.dev/search?q=...` con la `sk_`. Devuelve hasta 10 resultados ordenados por popularidad (la búsqueda está en beta pública; tolera cambios en la respuesta).
4. El front muestra los candidatos. La vista previa puede usar `https://img.logo.dev/{domain}?token=PK&size=64`.
5. El usuario elige uno → el front envía `POST /institutions` o `POST /subscriptions` con `name` y `domain`.
6. **Backend:** llama a `LogoService.ensureLogo(domain)`:
   - si `brands/{domain}.png` ya existe en el bucket, lo reutiliza;
   - si no, lo descarga de `img.logo.dev` con la `pk_`, lo sube al bucket y devuelve la ruta.
7. Se guarda `domain` y `logo_path` en la fila.
8. El front renderiza desde el bucket (URL pública de Supabase Storage).

## 3. Storage (Supabase)

- Bucket **público** `logos` (los logos de marcas no son sensibles).
- Rutas:
  - `brands/{domain}.png` → compartido entre usuarios y módulos.
  - `custom/{userId}/{entityId}.{ext}` → subidas manuales de un usuario.
- Las escrituras las hace **solo el backend** con la service role key. No crees políticas de escritura para clientes.
- Sube con `cacheControl: '31536000'` para que el navegador y el CDN cacheen por un año.

## 4. Backend (NestJS)

### Servicio de logos (compartido)

```ts
// src/shared/logos/logo.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const BUCKET = 'logos';

export function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '');
  d = d.split('/')[0].split('?')[0];
  return DOMAIN_RE.test(d) ? d : null;
}

@Injectable()
export class LogoService {
  private readonly log = new Logger(LogoService.name);
  private readonly supabase: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  /** Busca marcas por nombre (Logo.dev Search API). */
  async search(q: string) {
    const query = q?.trim();
    if (!query || query.length < 2) return [];

    const res = await fetch(
      `https://api.logo.dev/search?q=${encodeURIComponent(query)}`,
      {
        headers: { Authorization: `Bearer ${process.env.LOGO_DEV_SECRET_KEY}` },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) {
      this.log.warn(`Logo.dev search failed: ${res.status}`);
      return [];
    }
    const data = (await res.json()) as any[];
    // Verifica los nombres de campos contra la doc de Brand Search
    return data
      .map((r) => ({ name: r.name, domain: normalizeDomain(r.domain ?? '') }))
      .filter((r) => r.name && r.domain);
  }

  /** Garantiza que exista brands/{domain}.png y devuelve su ruta (o null). */
  async ensureLogo(rawDomain: string): Promise<string | null> {
    const domain = normalizeDomain(rawDomain);
    if (!domain) return null;

    const filename = `${domain}.png`;
    const path = `brands/${filename}`;

    // ¿ya existe? (la búsqueda es por prefijo: comparamos nombre exacto)
    const { data: found } = await this.supabase.storage
      .from(BUCKET)
      .list('brands', { search: filename, limit: 5 });
    if (found?.some((f) => f.name === filename)) return path;

    // descargar de Logo.dev; fallback=404 evita guardar monogramas genéricos
    const url =
      `https://img.logo.dev/${encodeURIComponent(domain)}` +
      `?token=${process.env.LOGO_DEV_PUBLISHABLE_KEY}&size=128&format=png&fallback=404`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null; // 404 = sin logo → el front usa iniciales

    const buffer = Buffer.from(await res.arrayBuffer());
    const { error } = await this.supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: 'image/png',
        cacheControl: '31536000',
        upsert: false,
      });
    // carrera: otro request lo subió primero → también es válido
    if (error && !/exists|duplicate/i.test(error.message)) {
      this.log.error(`Upload failed for ${domain}: ${error.message}`);
      return null;
    }
    return path;
  }

  /** Subida manual (prioridad sobre el logo de la marca). */
  async saveCustomLogo(
    userId: string,
    entityId: string,
    file: Express.Multer.File,
  ) {
    const allowed = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
    } as const;
    const ext = allowed[file.mimetype as keyof typeof allowed];
    if (!ext) throw new Error('Formato no permitido (usa PNG, JPG o WEBP)');
    if (file.size > 1_000_000) throw new Error('Máximo 1 MB');

    const path = `custom/${userId}/${entityId}.${ext}`;
    const { error } = await this.supabase.storage
      .from(BUCKET)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        cacheControl: '3600',
        upsert: true,
      });
    if (error) throw new Error(error.message);
    return path;
  }

  /** Construye la URL pública a partir de la ruta guardada. */
  publicUrl(path?: string | null): string | null {
    if (!path) return null;
    return this.supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  /** Prioridad: logo propio → logo de marca → null (iniciales en el front). */
  resolveUrl(row: {
    custom_logo_path?: string | null;
    logo_path?: string | null;
  }) {
    return this.publicUrl(row.custom_logo_path ?? row.logo_path);
  }
}
```

No permitas SVG en subidas manuales: un SVG puede contener scripts.

### Controlador de búsqueda

```ts
// src/shared/logos/logos.controller.ts
@Controller('brands')
@UseGuards(AuthGuard)
export class LogosController {
  constructor(private readonly logos: LogoService) {}

  @Get('search')
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // protege tu cuota
  search(@Query('q') q: string) {
    return this.logos.search(q);
  }
}
```

### Uso al crear una institución o suscripción

```ts
async create(userId: string, dto: CreateInstitutionDto) {
  const domain = dto.domain ? normalizeDomain(dto.domain) : null;
  const logoPath = domain ? await this.logos.ensureLogo(domain) : null;

  const row = await this.prisma.finInstitution.create({
    data: { userId, name: dto.name, domain, logoPath /* ... */ },
  });
  return { ...row, logoUrl: this.logos.resolveUrl({ logo_path: row.logoPath }) };
}
```

Si `ensureLogo` falla o devuelve `null`, la institución se crea igual (sin logo). El logo nunca debe bloquear el alta.

### Endpoint de subida manual

```ts
@Post(':id/logo')
@UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1_000_000 } }))
async uploadLogo(@Param('id') id: string, @CurrentUser() user, @UploadedFile() file: Express.Multer.File) {
  // valida que la institución pertenezca al usuario
  const path = await this.logos.saveCustomLogo(user.id, id, file);
  return this.institutions.update(user.id, id, { customLogoPath: path });
}
```

## 5. Frontend (Next.js)

### `next.config.js`

```js
module.exports = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '<tu-proyecto>.supabase.co' },
      // solo si usas next/image para las vistas previas del buscador:
      { protocol: 'https', hostname: 'img.logo.dev' },
    ],
  },
};
```

### Componente de logo con fallback a iniciales

```tsx
'use client';
import Image from 'next/image';
import { useState } from 'react';

type Props = { name: string; logoUrl?: string | null; size?: number };

export function BrandLogo({ name, logoUrl, size = 40 }: Props) {
  const [failed, setFailed] = useState(false);

  if (!logoUrl || failed) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center rounded-full bg-neutral-200 text-sm font-semibold text-neutral-700"
        aria-label={name}
      >
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <Image
      src={logoUrl}
      alt={name}
      width={size}
      height={size}
      className="rounded-full object-contain"
      onError={() => setFailed(true)}
    />
  );
}
```

### Buscador de marcas

```tsx
'use client';
import { useEffect, useState } from 'react';

const PK = process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY;

type Brand = { name: string; domain: string };

export function BrandPicker({ onSelect }: { onSelect: (b: Brand) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Brand[]>([]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/brands/search?q=${encodeURIComponent(q)}`,
          { signal: ctrl.signal },
        );
        if (res.ok) setResults(await res.json());
      } catch {
        /* cancelado */
      }
    }, 300); // debounce
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar marca…"
      />
      <ul>
        {results.map((r) => (
          <li
            key={r.domain}
            onClick={() => onSelect(r)}
            className="flex cursor-pointer items-center gap-2"
          >
            <img
              src={`https://img.logo.dev/${r.domain}?token=${PK}&size=64`}
              width={32}
              height={32}
              alt=""
            />
            <span>{r.name}</span>
            <small>{r.domain}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Ajusta la ruta `/api/brands/search` a como llames a tu backend (rewrite en `next.config.js` o URL absoluta del API).

Además del resultado de la búsqueda, deja siempre un campo para **escribir el dominio a mano** y una opción de **subir logo propio**: cubre bancos locales que la búsqueda no encuentre.

## 6. Manejo de casos borde

| Caso                                           | Comportamiento                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| Sin resultados en la búsqueda                  | Permitir dominio manual o subida propia                                          |
| `img.logo.dev` responde 404 (`fallback=404`)   | No se guarda archivo; `logo_path = null`; iniciales en el front                  |
| Falla de red / timeout                         | Crear la fila igual y reintentar el logo en segundo plano (job)                  |
| Dos usuarios agregan el mismo dominio a la vez | El `upload` con `upsert: false` puede fallar por existencia; se trata como éxito |
| Logo desactualizado                            | Sobrescribir `brands/{domain}.png` (script admin). Se actualiza para todos       |
| Usuario sube logo propio                       | `custom_logo_path` tiene prioridad y no afecta el archivo compartido             |

## 7. Prueba rápida antes de integrar

1. Prueba dominios locales: `bhd.com.do`, `banreservas.com`, `popularenlinea.com`, y verifica que cada uno devuelva un logo real (no monograma). Con `fallback=404` lo sabrás por el código de respuesta:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     "https://img.logo.dev/bhd.com.do?token=$LOGO_DEV_PUBLISHABLE_KEY&fallback=404"
   ```

2. Prueba la búsqueda con nombres locales ("BHD", "Banreservas", "APAP") y anota cuáles no aparecen; esos serán los que atiendas con dominio manual o subida propia.

## 8. Notas

- **Cuota y planes:** revisa el plan vigente y sus límites en el dashboard de Logo.dev; el README oficial menciona un nivel gratuito, pero confirma condiciones actuales.
- **Términos de uso:** antes de almacenar copias de los logos en tu bucket, revisa los términos de Logo.dev sobre caché/almacenamiento. Su integración estándar es el hotlink a `img.logo.dev`; la alternativa es guardar solo `domain` y renderizar desde su CDN.
- **Reportar logos incorrectos:** <https://www.logo.dev/update>
- **Transaction API (acceso temprano):** identifica el comercio a partir de una transacción cruda; útil más adelante para logos automáticos en `fin_transactions.merchant`.
