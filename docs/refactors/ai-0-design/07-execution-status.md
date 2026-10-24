# Preparación de AI-0 — estado de ejecución

2026-10-24. Rama aislada `refactor/ai-0`; seguimiento en
[#193](https://github.com/jarvinc3/personal-os-back/issues/193).

## Implementado antes del corte

- Paquete `@personal-os/contracts`, sin dependencias: interfaces y tokens del
  diseño, sin Nest, Prisma ni SDK de proveedores.
- `AiService` y toda su suite se trasladan de chat a `inference/application`.
  La entrada neutral `complete` delega al mismo pool y conserva failover,
  round-robin y atribución de proveedor/modelo.
- Quick-entry, estados de cuenta y el extractor bancario actual usan el puerto
  neutral. Se retira el puerto de chat de core, sin cambiar sus respuestas HTTP.
- Prueba de composición Nest del núcleo sin chat/Finance y pruebas de
  extracción de estados de cuenta por el puerto neutral.

Los contratos de capabilities/settings/intents se exportan para las siguientes
extracciones; todavía no sustituyen sus implementaciones actuales. La composición
final por dominio y el corte de runtime siguen pendientes.

## Gate operativo

El owner confirmó corte y backup verificados el 2026-10-24. Durante esta sesión
master avanzó a `018c4e0`, merge de #191, que contiene backend 0.55.3 y los
hotfixes previos; GitHub registró su despliegue production. El reporte de
metadatos PostgreSQL de PROD sigue pendiente. Se entrega una consulta de un
único resultado para SQL Editor: `artifacts/prod-preflight-report.readonly.sql`.

AI-0 se inicia como trabajo aislado de código con 0.100.0 unreleased, sin tags
ni deploys. El reemplazo del historial y cualquier reset quedan pendientes
del preflight. La preparación del corte de runtime continúa en esta rama.
La web conserva los cambios ajenos capturados en el inventario y no se modifica.

Para reemplazar el historial falta la salida saneada del preflight readonly
del proyecto PROD identificado. El backup y el corte se registran como
confirmación del owner, no como una restauración ejecutada por el agente.
No se necesitan secretos en el chat.
Los gates y comandos de ensayo están en [05-runbook.md](05-runbook.md).
