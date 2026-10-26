# AI-0 — diseño técnico del corte

Estado: **corte de código implementado en rama aislada y baseline validada en
PostgreSQL local**, preparado el 2026-10-24 sobre `origin/develop` `da123e1`
(`0.55.3`).
Seguimiento: [AI-0 #203](https://github.com/jarvinc3/personal-os-back/issues/203) y [programa #193](https://github.com/jarvinc3/personal-os-back/issues/193).
Avance preparatorio de código: [estado de ejecución](07-execution-status.md).
El owner confirmó el corte PROD y autorizó resetear DEV sin backup ni
restauración porque sus datos son de prueba. El preflight PROD readonly fue
entregado y auditado; la baseline se aplicó únicamente en DEV el 2026-10-24. No
se ha escrito en PROD. El proyecto DEV identificado es
`knqfgybflkpzplkqcocz`. Los archivos de
`artifacts/` no son migraciones activas.

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

La candidata pasó validación Prisma y un ensayo SQL de 18 comprobaciones con
fixtures explícitos de `auth` y `storage`. Es evidencia del DDL, restricciones,
policies, privilegios, triggers, referencias e independencia de sesiones.
El reporte no prueba Google OAuth, un despliegue Railway, APIs administradas
de Supabase ni que el código de aplicación ya compile contra esta candidata.
El corte de código compila y sus pruebas unitarias y E2E se ejecutan en la rama;
el comportamiento activo no se ha desplegado y conserva como rollback el
origen `0.55.3`.

## Estado y gates restantes

- Resetear y aplicar/verificar la baseline en DEV; completado el 2026-10-24.
  No se requirió backup ni restauración por decisión del owner; PROD quedó fuera
  de alcance.
- Aplicar y comprobar el trigger de borrado directo de Auth; completado en DEV
  mediante migración posterior y prueba transaccional reversible.
- Evidencia operativa de los fallos OAuth. El diagnóstico estático identifica
  casos concretos, pero no atribuye a uno de ellos los incidentes reportados.
- El smoke de API contra Supabase DEV pasó desde este checkout: alta/login/baja
  de usuario sintético, perfil, settings, Finance, notificaciones, marcas,
  ramas y wipe; chat/Gmail responden 404. Se usó Redis local Docker. Los workers
  vigentes arrancaron tras reiniciar el proceso y readiness respondió 200; no
  había jobs pendientes para probar recuperación de lease. Falta desplegar este
  SHA al servicio Railway DEV y reabrirlo.

La excepción a release por sesión para AI-0 está activa: ambos repos se
mantienen en `0.100.0` unreleased hasta decisión del owner tras AI-11.
