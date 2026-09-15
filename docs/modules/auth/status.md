# Auth — estado

Fecha: 2026-09-15

| Ítem | Estado | Evidencia |
| --- | --- | --- |
| JWT JWKS | `implemented` | `supabase-jwt.strategy.ts` + specs |
| GET session + debounce login | `implemented` | `auth.controller.ts`, cache key `user.logged_in:{sub}` TTL 3600_000 ms |
| Admin delete | `implemented` | `SupabaseAdminService`; cron de outbox en Users |
