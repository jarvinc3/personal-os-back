# Reconstrucción DEV y vuelta atrás

Estado: reset remoto y baseline de DEV ejecutados el 2026-10-24;
[#193](https://github.com/jarvinc3/personal-os-back/issues/193).
Decisión de Jarvin: todos los datos DEV son de prueba; no se requiere dump,
backup ni restauración. La pérdida de esos datos es aceptada. PROD nunca se
modifica hasta una decisión expresa posterior de Jarvin.

## Preparación sin reset

1. Verificar revisión y despliegue estables de back/web, workers y corte de
   hotfixes. Crear `release/0.55.x` desde el master estable comprobado, no desde
   un master local antiguo. Registrar SHA y configuración por nombres, sin valores.
2. Ejecutar el preflight readonly de PROD y comparar con el manifiesto. Resolver
   objetos manuales o diferencias antes de consolidar SQL. No editar migraciones
   aplicadas ni responder afirmativamente al reset de `prisma migrate dev`.
3. Congelar SHA de web y acordar destino de cambios sin commit. Completar plan
   de archivos y pruebas del corte antes de interrumpir DEV.
4. Identificar explícitamente el project ref DEV desde la configuración de
   conexión y cotejarlo con el proyecto acordado por el owner. Detener API,
   schedulers y workers DEV para evitar escrituras durante el reset; PROD sigue
   operativo y fuera de alcance.
5. No crear ni exigir dump, backup o restauración para este reset: Jarvin
   confirmó que los datos de DEV son desechables y autorizó reconstruirlos desde
   cero si fuera necesario. No copiar ni alterar Auth o Storage como parte del
   reset; se conservan sus identidades y objetos administrados.

## Procedimiento de ejecución AI-0

1. Activar versión 0.100.0 unreleased y su excepción de releases en back/web.
   Implementar las adaptaciones del plan, regenerar cliente Prisma y compilar.
2. Archivar historial SQL fuera de la ruta activa y conservar SHA/checksums.
   Crear una única migración baseline con timestamp libre posterior al último
   existente y fecha real anotada. Concatenar 00–05 en el orden documentado;
   ajustar namespaces solo según preflight verificado. No incluir fixtures de
   auth/storage ni el antiguo supabase-baseline.sql.
3. Ejecutar la baseline primero en una base vacía aislada y pasar los gates.
   Comparar drift contra la candidata. La baseline no debe intentar reconstruir
   esquemas administrados de Supabase.
4. Reconstruir únicamente los objetos propios de la aplicación en `public` de
   DEV: retirar explícitamente el trigger antiguo de `auth.users`, las tablas de
   aplicación incluida `_prisma_migrations` y los enums exclusivos de la
   aplicación. Preservar `auth`, `storage`, extensiones, grants del esquema,
   funciones/event triggers administrados de Supabase y el trigger global de
   RLS. No usar `DROP SCHEMA ... CASCADE`, `prisma migrate reset` ni resetear
   servicios gestionados. Validar la referencia DEV inmediatamente antes de la
   operación destructiva.
5. Aplicar migraciones con `prisma migrate deploy` a DEV. Ejecutar por separado
   06-dev-auth-reconcile.sql para identidades existentes. Verificar cuatro
   módulos, categorías y alta de perfil para una identidad nueva.
6. Vaciar o aislar trabajos DEV del contrato retirado por cola/nombre e impedir
   que un payload viejo se ejecute con el nuevo código. Conservar Resend y sus
   colas válidas; no purgar Redis completo por comodidad.
7. Arrancar API y workers DEV del mismo SHA, ejecutar smoke Auth/Finance/logos/
   notificaciones/settings/wipe y verificar que chat/Gmail no exponen rutas ni
   generan trabajos. Reiniciar un worker para probar recuperación de leases.

## Ejecución DEV — 2026-10-24

- Destino verificado antes de borrar: Supabase project ref
  `knqfgybflkpzplkqcocz`, PostgreSQL 17.11. El preflight encontró 49 tablas de
  aplicación y 38 enums en `public`; no encontró FKs desde otros schemas a esas
  tablas ni sesiones activas de la aplicación.
- En una transacción se retiraron las 49 tablas de `public`, incluido
  `_prisma_migrations`, los 38 enums y el trigger/Auth helper antiguos. No se
  usó `CASCADE` ni se recreó el schema `public`.
- `pnpm db:migrate:deploy` aplicó `20261101090003_ai0_baseline`; después se
  ejecutó `06-dev-auth-reconcile.sql` por separado. La migración posterior
  `20261101090004_auth_user_delete_cascade` instala el cleanup cuando se elimina
  directamente una identidad desde Auth.
- Verificación: 45 tablas de `public` incluida `_prisma_migrations` y todas con
  RLS; 23 policies, 18 checks y 4 índices parciales; 4 módulos, 31 categorías y
  1 perfil para 1 identidad Auth. El trigger `on_auth_user_created` apunta a
  `app_private.handle_new_user`. `auth.users`, `storage.buckets`, `uuid-ossp`,
  el event trigger `ensure_rls` y el bucket `logos` siguen presentes. `anon` y
  `authenticated` no tienen SELECT directo sobre `public.users`.
- El Redis configurado en `.env` corresponde a Railway DEV. En esa instancia se
  eliminaron únicamente las claves de las colas retiradas `gmail-sync` (32
  claves de historial terminal, sin jobs activos/pendientes) y `ai-processing`
  (2 claves de metadatos). No se purgaron las colas válidas. PROD no se tocó.
- El 2026-10-24 se ejecutó el smoke desde este checkout conectado a Supabase
  DEV y Redis local Docker: readiness, perfil, settings Finance, cuentas,
  instituciones, notificaciones, contador no leído, búsqueda de marcas, ramas
  de borrado y wipe respondieron 200. Se creó/inició y luego eliminó un usuario
  Auth sintético; el trigger retiró su perfil. Chat, Gmail y AI chat respondieron 404. Las escrituras del smoke pertenecieron al usuario sintético y se limpiaron.
- El proceso API/workers reinició con las colas activas `email-sync`,
  `notifications` y `statement-import`; readiness respondió 200 y Redis local
  solo mostró esas colas. No había jobs pendientes/activos para ejercer
  recuperación de leases. El pipeline habitual desplegó correctamente el API de
  Railway DEV (deployment `7296206450`, entorno development). Desde este entorno
  no se encontró una URL pública para repetir el health check de ese deployment;
  el smoke descrito arriba se ejecutó desde el checkout conectado a Supabase
  DEV. PROD sigue sin cambios.
- La prueba transaccional de la migración de borrado y su verificación posterior
  pasó: el trigger de alta creó el perfil de prueba, el trigger de Auth DELETE lo
  eliminó y la transacción se revirtió. No se conservó ningún usuario de prueba.

## Vuelta atrás

Si falla un gate, detener escritores DEV y corregir o volver a aplicar la
baseline en DEV. Los datos anteriores se consideran descartables por decisión
del owner; no hay rollback de datos. Desplegar solo un SHA compatible con el
esquema presente, reconciliar triggers/grants y comprobar Auth/storage sin
destruirlos. Reencolar trabajos solo tras validar compatibilidad de payload.
Repetir smoke y balances antes de reabrir DEV.

Esta propuesta no habilita un deploy/reset PROD. El owner decide merge y release
final después de los gates del programa.
