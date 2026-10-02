# Auth — overview

## Propósito

Resolver el contexto autenticado a partir de un JWT de Supabase Auth (JWKS). No implementa login email/password: eso es Supabase + cliente.

## Alcance

- Validar Bearer con estrategia `supabase-jwt` (Passport).
- Exponer sesión para bootstrap (`GET /api/auth/session`).
- Emitir `user.logged_in` con debounce 1h.
- Servicios admin: borrar usuario Auth (`SupabaseAdminService`) usados por Users al eliminar cuenta.
- Verificador JWKS reutilizado por el gateway WebSocket.

## Fuera de alcance

- Pantallas de login, OAuth Google de **usuario** (eso es Supabase + web).
- OAuth Gmail bancario (Finance ingestion).

## Arquitectura

Simple-module. Root: `auth.module.ts` + `index.ts`. Sin carpeta `application/` (no hay orquestación). Estándar: [architecture/modules.md](../../architecture/modules.md).

```text
packages/auth/src/
  presentation/       # auth.controller
  infrastructure/     # JWT strategy, verifier, supabase-admin, JWKS
  domain/             # supabase-jwt-payload
```

**Barrel:** `AuthModule`, `SupabaseAdminService`, `SupabaseJwtVerifierService`, `SupabaseJwtStrategy`, `AuthUserContext`, `SupabaseJwtPayload`.

Guarding HTTP es global (`JwtAuthGuard`); `@Public()` para health y callback Gmail.
