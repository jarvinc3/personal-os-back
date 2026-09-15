# Users — estado

Fecha: 2026-09-15

| Ítem | Estado | Evidencia |
| --- | --- | --- |
| CRUD perfil | `implemented` | `users.controller.ts`, e2e |
| Module config merge | `implemented` | `domain/` defaults |
| Delete account + Auth outbox | `implemented` | processor + cron EVERY_MINUTE |
| Finance disabled → 403 REST | `implemented` | `EnabledModuleGuard` |
| Otros dominios `@RequiresEnabledModule` | `planned` | solo finance lo usa hoy — REV-BACK-006 |
