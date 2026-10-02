# Logos

Resuelve y almacena logos de instituciones y redes de tarjeta.

## Código

`packages/logos/src/`:

- `presentation/logos.controller.ts` — búsqueda y subida.
- `application/logo.service.ts` — caché, resolución de URL y reglas de subida.
- `application/ports/` — `LogoStoragePort` (bucket) y `BrandLogoPort` (logo.dev).
- `infrastructure/supabase-logo.storage.ts` y `logo-dev.brand.client.ts` — adaptadores.
- `domain/` — normalización de dominio y dominios de redes de tarjeta.

## Flujo

`ensureLogo` reutiliza el archivo existente, descarga de logo.dev si falta y sube a Supabase. Las redes de tarjeta se precalientan en `onApplicationBootstrap`, así que las consultas de ledger y catálogo no mutan. `resolveUrl` prioriza logo propio, logo compartido y URL legada.

Consumidores: `finance` (catálogo y ledger) vía `LogoService`.
