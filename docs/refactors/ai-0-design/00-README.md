# AI-0 — diseño técnico del corte

Estado: **propuesta técnica validada en una base local aislada**, preparada el
2026-10-24 sobre backend `37b9ec875a640e023745add670a7d3b381a83c12` (`0.55.2`).
Seguimiento: [programa #193](https://github.com/jarvinc3/personal-os-back/issues/193).
Avance preparatorio de código: [estado de ejecución](07-execution-status.md).
El código de AI-0 se inicia en rama aislada tras confirmación del corte/backup
por el owner; ver el estado enlazado. No se ha reseteado DEV ni consultado o
cambiado la base de PROD. Los archivos de `artifacts/` no son migraciones activas.

| Entregable                             | Documento / artefacto                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Modelos, FKs, enums e índices exactos  | [01-baseline.md](01-baseline.md), [schema.prisma](artifacts/schema.prisma)                              |
| DDL y SQL no representado por Prisma   | `artifacts/00-prerequisites.sql` a `06-dev-auth-reconcile.sql`                                          |
| Contratos y dependencias               | [02-contracts.md](02-contracts.md), `artifacts/contracts.draft.ts`, `artifacts/finance-import.draft.ts` |
| Archivos por repo y cambios pendientes | [03-file-plan.md](03-file-plan.md), `artifacts/file-plan.json`                                          |
| Evidencia de OAuth y corte operativo   | [04-oauth-and-preflight.md](04-oauth-and-preflight.md), `artifacts/prod-preflight.readonly.sql`         |
| Reconstrucción y rollback DEV          | [05-runbook.md](05-runbook.md)                                                                          |
| Pruebas de fases 0/1/2 y aceptación    | [06-test-matrix.md](06-test-matrix.md), `artifacts/validation-report.json`                              |

## Decisiones concretas de este diseño

1. La baseline de AI-0 tiene 44 modelos. No anticipa las tablas de corpus,
   roles, inferencias o conocimiento: se agregan en sus fases con migraciones
   normales. La separación de responsabilidades sí se fija desde AI-0.
2. Se retiran `AiAgentSession`, `AiMessage` y los cuatro `FinEmail*`.
   `AiAction` se conserva sin FKs a conversación: usa `userId` como dueño y
   `originType`/`originReference` como correlación opaca. No tiene endpoints ni
   ejecutor activo hasta reconstruir agencia/policy.
3. `FinTransaction.emailMessageId` y su FK se sustituyen por
   `importReference`, único por usuario cuando no es nulo. No hay FK Finance →
   AiSignal ni lectura de correo desde el ledger. La marca `source=EMAIL` se
   conserva como procedencia descriptiva, no como integración Gmail.
4. Los algoritmos financieros conservados siguen compilando y probándose.
   Los workers/repositorios de candidatos dependientes de email se separan
   detrás de puertos financieros; esos adaptadores no se registran hasta FIN-3.
5. Se conserva el SQL financiero no generado por Prisma. La función de alta
   Auth pasa a `app_private`, la policy de acciones deja de depender de sesiones
   y el bucket logos se alinea con los MIME que ya acepta el backend.
6. Se agregan cuatro filas de módulos configurables al bootstrap DEV. La base
   vacía migrada actual tiene cero filas en `modules`; sin esta decisión, el
   onboarding no puede configurar Finanzas después del reset.
7. Después del reset se reconstruyen perfiles de Auth existentes en DEV. Borrar
   `public` no borra `auth.users`, y el trigger de alta no se dispara para
   identidades antiguas. No se copian conversaciones ni datos financieros.

## Qué significa la validación

La candidata pasó validación Prisma y un ensayo SQL de 16 comprobaciones con
fixtures explícitos de `auth` y `storage`. Es evidencia del DDL, restricciones,
policies, privilegios, triggers, referencias e independencia de sesiones.
El reporte no prueba Google OAuth, un despliegue Railway, APIs administradas
de Supabase ni que el código de aplicación ya compile contra esta candidata.
Ese último gate se ejecuta al implementar AI-0, después de aplicar el plan de
archivos; el comportamiento activo conserva el del origen `0.55.2`, con un
PATCH documental independiente para este diseño.

## Gates pendientes antes de ejecutar

- Merge/corte estable real de back y web; comprobación del despliegue y estado
  de workers. No basta con que exista un tag en develop.
- Lectura de `_prisma_migrations`, extensiones y objetos no versionados en PROD
  con conexión identificada de solo lectura; comparar con el manifiesto local.
- Evidencia operativa de los fallos OAuth. El diagnóstico estático identifica
  casos concretos, pero no atribuye a uno de ellos los incidentes reportados.
- Congelar el SHA web y resolver sus cambios de trabajo con su autor. No se han
  sobrescrito ni incluido en commits de este diseño.
- Backup DEV verificable y ensayo de restauración; no hay restauración real
  de datos de DEV validada mediante fixtures locales.

La excepción a release por sesión todavía no se activa. Este diseño documental
lleva PATCH normal. Solo la ejecución aprobada de AI-0 inicia `0.100.0` unreleased.
