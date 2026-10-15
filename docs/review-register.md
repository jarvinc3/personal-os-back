# Registro de revisión — personal-os-back

Afirmaciones de la documentación original (README, `core-infrastructure.md`, `finance.md`, módulos planos, `docs/ai-tools/*`) que no se presentan como vigentes sin marca. Ninguna se eliminó sin destino.

Estados: ver [documentation-standard.md](./documentation-standard.md).

## REV-BACK-001 {#rev-back-001}

| Campo         | Valor                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Categoría     | `NO_IMPLEMENTADO`                                                                                                         |
| Origen        | `docs/core-infrastructure.md`: interceptors incluyen logging                                                              |
| Validación    | `CoreModule` no registra `LoggingInterceptor` ni `RolesGuard` como APP_*                                                  |
| Evidencia     | `packages/core/src/core.module.ts`; archivos `logging.interceptor.ts`, `roles.guard.ts` existen; `@Roles` sin usos        |
| Impacto       | Agentes pueden creer que hay logging HTTP interceptor y RBAC activo                                                       |
| Recomendación | Registrar interceptor o borrar archivos muertos; RolesGuard igual                                                         |
| Resolución    | `resolved` (2026-10-15, back `v0.36.0`): `LoggingInterceptor` registrado; `RolesGuard`, `@Roles` y `ROLES_KEY` eliminados |

## REV-BACK-002 {#rev-back-002}

| Campo         | Valor                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Categoría     | `NO_VERIFICABLE` (env no validado al boot)                                                                             |
| Origen        | cuotas AI documentadas implícitamente vía helpers                                                                      |
| Validación    | `MAX_EMAIL_LLM_EXTRACTS`, `AI_DAILY_INSIGHT_QUOTA` leídos de `process.env`, ausentes de `env.schema.ts`                |
| Recomendación | Añadir al schema Zod o documentar como no soportados en boot                                                           |
| Resolución    | `resolved` (2026-10-15, back `v0.36.0`): `MAX_EMAIL_LLM_EXTRACTS` y `AI_DAILY_INSIGHT_QUOTA` validados en `env.schema` |

## REV-BACK-003 {#rev-back-003}

| Campo         | Valor                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| Categoría     | `NO_IMPLEMENTADO`                                                                                             |
| Origen        | `event.constants.ts` + core-infra “ops / future consumers”                                                    |
| Validación    | grep emit/enqueue `finance.email_sync.failed` en `src/` → sin matches de producción                           |
| Recomendación | Emitir en fallo de sync o retirar del catálogo “vigente”                                                      |
| Resolución    | `resolved` (2026-10-15, back `v0.36.0`): `finance.email_sync.failed` se encola en el outbox al fallar un sync |

## REV-BACK-004 {#rev-back-004}

| Campo         | Valor                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| Categoría     | `CONTRADICE_CODIGO`                                                                         |
| Origen        | comentario `app.module.ts` “no @Cron handlers yet”                                          |
| Validación    | 4 crons: FinanceOutbox 30s, AuthDeletion 1m, AiActionsReaper 5m, GmailAutoSync 6h           |
| Recomendación | Actualizar comentario en código                                                             |
| Resolución    | `resolved` (2026-10-15, back `v0.36.0`): comentario de crons actualizado en `app.module.ts` |

## REV-BACK-005 {#rev-back-005}

| Campo          | Valor                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Categoría      | `NO_IMPLEMENTADO`                                                                                                                                         |
| Origen         | README / finance.md / `package.json` `db:reconcile-balances`; smoke `prisma/scripts/smoke-finance-http.ts`                                                |
| Validación     | `prisma/scripts/` no existe                                                                                                                               |
| Texto original | “`pnpm db:reconcile-balances` One-shot: recalcular balances…” y smoke PASS 2026-08-07                                                                     |
| Recomendación  | Restaurar scripts o quitar comandos del package.json                                                                                                      |
| Resolución     | `resolved` (2026-10-15, back `v0.36.0`): `db:reconcile-balances` retirado; smoke HTTP en `scripts/finance/smoke-finance-http.ts` con `pnpm smoke:finance` |

## REV-BACK-006 {#rev-back-006}

| Campo      | Valor                                                    |
| ---------- | -------------------------------------------------------- |
| Categoría  | `PARCIALMENTE_IMPLEMENTADO`                              |
| Origen     | users.md “other domain APIs unchanged until they opt in” |
| Validación | solo finance usa `@RequiresEnabledModule`                |
| Resolución | `roadmap` — [roadmap.md](./roadmap.md)                   |

## REV-BACK-007 {#rev-back-007}

| Campo      | Valor                                                                    |
| ---------- | ------------------------------------------------------------------------ |
| Categoría  | `NO_VERIFICABLE`                                                         |
| Origen     | docs web/core-infra “pendiente FCM/APNs real (sender en backend)”        |
| Validación | hay Expo access token + VAPID web-push; no hay adapter FCM/APNs dedicado |
| Resolución | `roadmap` — [roadmap.md](./roadmap.md)                                   |

## REV-BACK-008 {#rev-back-008}

| Campo      | Valor                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| Categoría  | `NO_IMPLEMENTADO`                                                                  |
| Origen     | project-guide / ai.md web: `agenda-tools.md` etc.                                  |
| Validación | `MODULE_CONTEXT` para esos slugs solo tools de usuario/módulo, no tools de dominio |
| Resolución | `roadmap` — [roadmap.md](./roadmap.md)                                             |

## REV-BACK-009 {#rev-back-009}

| Campo      | Valor                                                                                 |
| ---------- | ------------------------------------------------------------------------------------- |
| Categoría  | `CONTRADICE_CODIGO`                                                                   |
| Origen     | README “API <http://localhost:3100”>; schema `PORT` default 3000                      |
| Validación | `env.schema.ts` default 3000; `.env.example` PORT=3100                                |
| Nota       | El valor real es el env; no hay un único default                                      |
| Resolución | `resolved` (2026-10-15, back `v0.36.0`): `PORT` default 3100 igual que `.env.example` |

## REV-BACK-010 {#rev-back-010}

| Campo      | Valor                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Categoría  | `CONTEXTO_NO_APLICABLE` / paths rotos                                                          |
| Origen     | `docs/ai-tools/finance-tools.md`, `docs/modules/finance.md` (plano)                            |
| Validación | git status muestra D de esos paths; contenido migrado a `docs/modules/finance/` y `contracts/` |
| Resolución | `migrated`                                                                                     |

## REV-BACK-011 {#rev-back-011}

| Campo      | Valor                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| Categoría  | `PARCIALMENTE_IMPLEMENTADO`                                                                              |
| Origen     | finance.md “Last smoke run (2026-08-07): PASS”                                                           |
| Validación | no se re-ejecutó el script (ausente); e2e mock existe                                                    |
| Resolución | `resolved` (2026-10-15, back `v0.36.0`): el smoke nuevo sustituye la corrida histórica `PASS 2026-08-07` |

## REV-BACK-012 {#rev-back-012}

| Campo         | Valor                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| Categoría     | `CONTRADICE_RUNTIME` (docs antiguas incompletas)                                            |
| Origen        | `core-infrastructure.md`: ready “solo expone `status` y `timestamp`” sin mencionar envelope |
| Validación    | `curl` 2026-09-15: `{ data: { status, timestamp }, meta: { timestamp, path, requestId } }`  |
| Recomendación | Tratar envelope+data como contrato real                                                     |
| Resolución    | `migrated` (health.md actualizado)                                                          |

## REV-BACK-013 {#rev-back-013}

| Campo      | Valor                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Categoría  | `NO_IMPLEMENTADO`                                                                                                                                            |
| Origen     | `docs/decisions/ADR-006-cursor-pagination.md`                                                                                                                |
| Validación | `packages/core/src/pagination/` usa `CursorQueryDto` y `{ items, nextCursor, hasMore }`; movimientos, presupuestos, notificaciones y sesiones de IA migrados |
| Resolución | `resolved`                                                                                                                                                   |
