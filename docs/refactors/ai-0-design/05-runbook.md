# Reconstrucción DEV y vuelta atrás

Estado: código y ensayo de baseline listos; reset remoto `NO_EJECUTADO`;
[#193](https://github.com/jarvinc3/personal-os-back/issues/193). El owner
confirmó backup DEV, pero falta identificar su project ref y comprobar la
restauración de ese proyecto. Nunca ejecutar contra PROD.

## Preparación sin reset

1. Verificar revisión y despliegue estables de back/web, workers y corte de
   hotfixes. Crear `release/0.55.x` desde el master estable comprobado, no desde
   un master local antiguo. Registrar SHA y configuración por nombres, sin valores.
2. Ejecutar el preflight readonly de PROD y comparar con el manifiesto. Resolver
   objetos manuales o diferencias antes de consolidar SQL. No editar migraciones
   aplicadas ni responder afirmativamente al reset de `prisma migrate dev`.
3. Congelar SHA de web y acordar destino de cambios sin commit. Completar plan
   de archivos y pruebas del corte antes de interrumpir DEV.
4. Identificar explícitamente el proyecto Supabase DEV, DB/host y storage. Detener
   API, schedulers y workers DEV para impedir escrituras y reintentos durante
   backup/reset; conservar PROD operativo.
5. Obtener backup consistente con herramientas compatibles con la versión del
   servidor. Guardar dump cifrado fuera del repo, checksum, versión de pg_dump y
   revisión. Incluir datos/esquema de aplicación y un inventario de Auth,
   storage, funciones, grants y extensiones; un dump de public no incluye objetos
   del bucket. No asumir que un dump lógico puede recrear servicios gestionados.
6. Restaurar primero en un entorno aislado compatible. Verificar conteos,
   balances, ownership, referencias, Auth y acceso a logos. Registrar comandos y
   resultados saneados. Sin restauración comprobada, no continuar al reset.

## Ejecución futura de AI-0

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
4. Reconstruir únicamente el esquema de aplicación de DEV mediante un comando
   revisado para ese proyecto. Debe limpiar también su historial Prisma antiguo
   y dependencias externas del trigger de alta de forma explícita; no lanzar
   DROP SCHEMA CASCADE sin revisar dependencias ni resetear auth/storage.
   El comando destructivo concreto se prepara después del preflight, no se
   presenta aquí como receta universal.
5. Aplicar migraciones con `prisma migrate deploy` a DEV. Ejecutar por separado
   06-dev-auth-reconcile.sql para identidades existentes. Verificar cuatro
   módulos, categorías y alta de perfil para una identidad nueva.
6. Vaciar o aislar trabajos DEV del contrato retirado por cola/nombre e impedir
   que un payload viejo se ejecute con el nuevo código. Conservar Resend y sus
   colas válidas; no purgar Redis completo por comodidad.
7. Arrancar API y workers DEV del mismo SHA, ejecutar smoke Auth/Finance/logos/
   notificaciones/settings/wipe y verificar que chat/Gmail no exponen rutas ni
   generan trabajos. Reiniciar un worker para probar recuperación de leases.

## Vuelta atrás

Si falla un gate, detener escritores DEV. Restaurar el backup de aplicación
verificado junto a su historial `_prisma_migrations`, y desplegar exactamente el
SHA/configuración anterior; no arrancar binarios antiguos contra la baseline
nueva. Reconciliar triggers/grants y comprobar Auth/storage sin destruirlos.
Restaurar o reencolar trabajos solo tras validar compatibilidad de payload.
Repetir smoke y balances antes de reabrir DEV. Los datos creados después del
backup requieren una decisión explícita de recuperación, no una mezcla automática.

Esta propuesta no habilita un deploy/reset PROD. El owner decide merge y release
final después de los gates del programa.
