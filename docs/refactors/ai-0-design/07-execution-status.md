# AI-0 — estado de ejecución

2026-10-24. Integrado en `develop` desde `refactor/ai-0`; seguimiento en
[#193](https://github.com/jarvinc3/personal-os-back/issues/193).

## Corte de código implementado

- Paquete `@personal-os/contracts`, sin dependencias: interfaces y tokens del
  diseño, sin Nest, Prisma ni SDK de proveedores.
- `AiService` y toda su suite se trasladan de chat a `inference/application`.
  La entrada neutral `complete` delega al mismo pool y conserva failover,
  round-robin y atribución de proveedor/modelo.
- Quick-entry, estados de cuenta y el extractor bancario actual usan el puerto
  neutral. Se retira el puerto de chat de core, sin cambiar sus respuestas HTTP.
- Prueba de composición Nest del núcleo sin chat/Finance y pruebas de
  extracción de estados de cuenta por el puerto neutral.
- Se retiraron del runtime back los controladores, tablas, colas y settings de
  chat/Gmail; la importación financiera y sus reglas quedan con specs, sin
  llamadores hasta AI-11. La entrega de correo de notificaciones por Resend
  permanece activa.
- Se aplicó una única migración baseline y se archivó el historial anterior;
  schema Prisma, SQL manual de #169, RLS/grants y el índice parcial de
  transferencias se comprobaron en PostgreSQL local.
- La rama web `refactor/ai-0` tiene el commit inicial `512b0dc`; sus rutas de
  chat/Gmail y sus ajustes visibles quedaron fuera.

Los contratos de capabilities/settings/intents se exportan para las siguientes
extracciones; todavía no sustituyen sus implementaciones actuales. La composición
La composición completa por dominio y los contratos de fases AI-2+ siguen
pendientes; el corte AI-0 del runtime sí está implementado en la rama.

## Gate operativo

El owner confirmó corte PROD 0.55.3 el 2026-10-24. Se recibió y
auditó el reporte de metadatos PostgreSQL de PROD: 67 migraciones aplicadas,
sin pendientes, extensiones y objetos, RLS/policies, grants y cuatro índices
parciales fueron comparados con los artefactos locales. No se escribió en PROD.

AI-0 fue integrado en `develop` mediante el PR de backend #195 y el PR web #311.
La línea 0.100.0 sigue unreleased, sin tags ni release de producción. La
baseline pasó `migrate deploy`, comparación de drift y 18
validaciones contra PostgreSQL local 17. Jarvin decidió que no se requiere
dump, backup ni restauración: los datos DEV son de prueba y se acepta su pérdida.
La configuración local apunta al proyecto DEV `knqfgybflkpzplkqcocz`. El
preflight remoto confirmó PostgreSQL 17.11, 59 migraciones antiguas y 49 tablas
`public` con RLS. El 2026-10-24 se retiraron en una transacción las 49 tablas,
los 38 enums de aplicación y el trigger/Auth helper legado; luego se aplicó
`20261101090003_ai0_baseline` y se ejecutó `06-dev-auth-reconcile.sql`.
Luego se aplicó `20261101090004_auth_user_delete_cascade`, que elimina el perfil
de `public.users` cuando se borra directamente la identidad Auth y deja que sus
FKs limpien los datos asociados.

La verificación remota encontró 45 tablas `public` incluyendo el historial,
todas con RLS; 23 policies, 18 checks, 4 índices parciales, 4 módulos, 31
categorías y 1 perfil reconciliado con la identidad Auth existente. Auth,
Storage, `uuid-ossp`, el event trigger `ensure_rls` y el bucket `logos` se
preservaron. No se escribió en PROD. El smoke de API desde este checkout contra
Supabase DEV pasó para Auth, perfil, settings, Finance, notificaciones, marcas
y wipe; las rutas chat/Gmail devuelven 404. Se usó Redis local Docker. Los
workers reiniciaron y readiness devolvió 200; al no haber jobs pendientes, no
se pudo ejercitar recuperación de leases. En Redis Railway DEV se retiraron
solo las claves de `gmail-sync` (32 claves terminales) y `ai-processing` (2
metadatos), preservando las colas vigentes. El pipeline habitual desplegó el API
de Railway DEV en el deployment `7296206450` (entorno development). No se
encontró una URL pública desde este entorno para repetir el health check del
deployment; el smoke anterior se ejecutó desde el checkout conectado a DEV.
PROD sigue sin cambios.
Una prueba transaccional en DEV confirmó alta del perfil por INSERT, limpieza
por DELETE de Auth y rollback completo del usuario sintético.

La decisión del owner sobre los datos de prueba reemplaza el gate de backup y
restauración. No se necesitan secretos en el chat. El resultado y los pasos
pendientes están en [05-runbook.md](05-runbook.md).
