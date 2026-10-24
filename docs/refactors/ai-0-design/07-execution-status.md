# Preparación de AI-0 — estado de ejecución

2026-10-24. Rama aislada `refactor/ai-0`; seguimiento en
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

El owner confirmó corte PROD 0.55.3 y backup DEV el 2026-10-24. Se recibió y
auditó el reporte de metadatos PostgreSQL de PROD: 67 migraciones aplicadas,
sin pendientes, extensiones y objetos, RLS/policies, grants y cuatro índices
parciales fueron comparados con los artefactos locales. No se escribió en PROD.

AI-0 continúa como trabajo aislado con 0.100.0 unreleased, sin tags, releases
ni deploys. La baseline pasó `migrate deploy`, comparación de drift y 18
validaciones contra PostgreSQL local 17. El reset Supabase DEV sigue pendiente
de identificar la conexión/proyecto correcto y demostrar la restauración del
backup de ese proyecto.

El backup y el corte se registran como confirmación del owner, no como una
restauración ejecutada por el agente. No se necesitan secretos en el chat.
Los gates y comandos de ensayo están en [05-runbook.md](05-runbook.md).
