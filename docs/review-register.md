# Registro de revisión — personal-os-back

Afirmaciones de la documentación original (README, `core-infrastructure.md`, `finance.md`, módulos planos, `docs/ai-tools/*`) que no se presentan como vigentes sin marca. Ninguna se eliminó sin destino.

Estados: ver [documentation-standard.md](./documentation-standard.md).

## REV-BACK-001 {#rev-back-001}

| Campo         | Valor                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| Categoría     | `NO_IMPLEMENTADO`                                                                                         |
| Origen        | `docs/core-infrastructure.md`: interceptors incluyen logging                                              |
| Validación    | `CoreModule` no registra `LoggingInterceptor` ni `RolesGuard` como APP_*                                  |
| Evidencia     | `src/core/core.module.ts`; archivos `logging.interceptor.ts`, `roles.guard.ts` existen; `@Roles` sin usos |
| Impacto       | Agentes pueden creer que hay logging HTTP interceptor y RBAC activo                                       |
| Recomendación | Registrar interceptor o borrar archivos muertos; RolesGuard igual                                         |
| Resolución    | `open`                                                                                                    |

## REV-BACK-002 {#rev-back-002}

| Campo         | Valor                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| Categoría     | `NO_VERIFICABLE` (env no validado al boot)                                                              |
| Origen        | cuotas AI documentadas implícitamente vía helpers                                                       |
| Validación    | `MAX_EMAIL_LLM_EXTRACTS`, `AI_DAILY_INSIGHT_QUOTA` leídos de `process.env`, ausentes de `env.schema.ts` |
| Recomendación | Añadir al schema Zod o documentar como no soportados en boot                                            |
| Resolución    | `open`                                                                                                  |

## REV-BACK-003 {#rev-back-003}

| Campo         | Valor                                                                               |
| ------------- | ----------------------------------------------------------------------------------- |
| Categoría     | `NO_IMPLEMENTADO`                                                                   |
| Origen        | `event.constants.ts` + core-infra “ops / future consumers”                          |
| Validación    | grep emit/enqueue `finance.email_sync.failed` en `src/` → sin matches de producción |
| Recomendación | Emitir en fallo de sync o retirar del catálogo “vigente”                            |
| Resolución    | `open`                                                                              |

## REV-BACK-004 {#rev-back-004}

| Campo         | Valor                                                           |
| ------------- | --------------------------------------------------------------- |
| Categoría     | `CONTRADICE_CODIGO`                                             |
| Origen        | comentario `app.module.ts` “no @Cron handlers yet”              |
| Validación    | 3 crons: FinanceOutbox 30s, AuthDeletion 1m, AiActionsReaper 5m |
| Recomendación | Actualizar comentario en código                                 |
| Resolución    | `open`                                                          |

## REV-BACK-005 {#rev-back-005}

| Campo          | Valor                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Categoría      | `NO_IMPLEMENTADO`                                                                                          |
| Origen         | README / finance.md / `package.json` `db:reconcile-balances`; smoke `prisma/scripts/smoke-finance-http.ts` |
| Validación     | `prisma/scripts/` no existe                                                                                |
| Texto original | “`pnpm db:reconcile-balances` One-shot: recalcular balances…” y smoke PASS 2026-08-07                      |
| Recomendación  | Restaurar scripts o quitar comandos del package.json                                                       |
| Resolución     | `open`                                                                                                     |

## REV-BACK-006 {#rev-back-006}

| Campo      | Valor                                                                |
| ---------- | -------------------------------------------------------------------- |
| Categoría  | `PARCIALMENTE_IMPLEMENTADO`                                          |
| Origen     | users.md “other domain APIs unchanged until they opt in”             |
| Validación | solo finance usa `@RequiresEnabledModule`                            |
| Resolución | `open` (comportamiento real documentado en `users/rules/modules.md`) |

## REV-BACK-007 {#rev-back-007}

| Campo      | Valor                                                                    |
| ---------- | ------------------------------------------------------------------------ |
| Categoría  | `NO_VERIFICABLE`                                                         |
| Origen     | docs web/core-infra “pendiente FCM/APNs real (sender en backend)”        |
| Validación | hay Expo access token + VAPID web-push; no hay adapter FCM/APNs dedicado |
| Resolución | `open`                                                                   |

## REV-BACK-008 {#rev-back-008}

| Campo      | Valor                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| Categoría  | `NO_IMPLEMENTADO`                                                                  |
| Origen     | project-guide / ai.md web: `agenda-tools.md` etc.                                  |
| Validación | `MODULE_CONTEXT` para esos slugs solo tools de usuario/módulo, no tools de dominio |
| Resolución | `open`                                                                             |

## REV-BACK-009 {#rev-back-009}

| Campo      | Valor                                                            |
| ---------- | ---------------------------------------------------------------- |
| Categoría  | `CONTRADICE_CODIGO`                                              |
| Origen     | README “API <http://localhost:3100”>; schema `PORT` default 3000 |
| Validación | `env.schema.ts` default 3000; `.env.example` PORT=3100           |
| Nota       | El valor real es el env; no hay un único default                 |
| Resolución | `open` (documentado en quick-start)                              |

## REV-BACK-010 {#rev-back-010}

| Campo      | Valor                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Categoría  | `CONTEXTO_NO_APLICABLE` / paths rotos                                                          |
| Origen     | `docs/ai-tools/finance-tools.md`, `docs/modules/finance.md` (plano)                            |
| Validación | git status muestra D de esos paths; contenido migrado a `docs/modules/finance/` y `contracts/` |
| Resolución | `migrated`                                                                                     |

## REV-BACK-011 {#rev-back-011}

| Campo      | Valor                                                 |
| ---------- | ----------------------------------------------------- |
| Categoría  | `PARCIALMENTE_IMPLEMENTADO`                           |
| Origen     | finance.md “Last smoke run (2026-08-07): PASS”        |
| Validación | no se re-ejecutó el script (ausente); e2e mock existe |
| Resolución | `open`                                                |

## REV-BACK-012 {#rev-back-012}

| Campo         | Valor                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| Categoría     | `CONTRADICE_RUNTIME` (docs antiguas incompletas)                                            |
| Origen        | `core-infrastructure.md`: ready “solo expone `status` y `timestamp`” sin mencionar envelope |
| Validación    | `curl` 2026-09-15: `{ data: { status, timestamp }, meta: { timestamp, path, requestId } }`  |
| Recomendación | Tratar envelope+data como contrato real                                                     |
| Resolución    | `migrated` (health.md actualizado)                                                          |
