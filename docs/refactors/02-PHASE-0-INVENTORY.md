# Inventario previo a fase 0

Inventario refrescado el 2026-10-24 sobre `origin/develop` `da123e1` (0.55.3),
antes del corte de código AI-0. La rama de ejecución implementa el corte; el
reset remoto y la baseline se aplicaron al proyecto DEV autorizado
`knqfgybflkpzplkqcocz` el 2026-10-24.
Decisiones: [01-IMPLEMENTATION-DECISIONS.md](01-IMPLEMENTATION-DECISIONS.md).

## Finance: preservar implementación y pruebas

Estos archivos contienen reglas financieras reutilizables. El nombre email no
es criterio suficiente para eliminarlos. En fase 0 solo se desacoplan tipos de
fuente; en fase 11 reciben señales.

- `packages/finance/src/ingestion/application/build-email-import-notes.spec.ts`
- `packages/finance/src/ingestion/application/build-email-import-notes.ts`
- `packages/finance/src/ingestion/application/email-movement.spec.ts`
- `packages/finance/src/ingestion/application/email-movement.ts`
- `packages/finance/src/ingestion/application/match-email-transfers.spec.ts`
- `packages/finance/src/ingestion/application/match-email-transfers.ts`
- `packages/finance/src/ingestion/application/parse-extracted-email.spec.ts`
- `packages/finance/src/ingestion/application/parse-extracted-email.ts`
- `packages/finance/src/ingestion/application/resolve-email-ledger-target.spec.ts`
- `packages/finance/src/ingestion/application/resolve-email-ledger-target.ts`
- `packages/finance/src/ingestion/application/resolve-reverse-original.ts`

Además se conservan los archivos de ledger de importación y sus pruebas:

- `packages/finance/src/ledger/application/import-email-transaction.use-case.ts`
- `packages/finance/src/ledger/infrastructure/prisma-ledger-email-import.repository.ts`

La deduplicación por referencia bancaria y su índice parcial, las conversiones
FX, las piernas de operaciones y la actualización transaccional de saldos se
conservan. Los nuevos comercios, alias, categorías aprendidas, fusiones y logos
son dominio vigente: no se eliminan ni se revierten al estado del 20 de octubre.

## Finance: separar antes de retirar adaptadores

Contienen mezcla de persistencia/fuente y reglas financieras. Extraer la parte
financiera con sus fixtures y pruebas antes de eliminar la integración Gmail.
No mover la carpeta completa a IA ni borrar estos archivos en bloque.

- `packages/finance/src/ingestion/application/backfill-pending-email.use-case.spec.ts`
- `packages/finance/src/ingestion/application/backfill-pending-email.use-case.ts`
- `packages/finance/src/ingestion/application/ingestion.service.spec.ts`
- `packages/finance/src/ingestion/application/ingestion.service.ts`
- `packages/finance/src/ingestion/application/process-gmail-sync.use-case.spec.ts`
- `packages/finance/src/ingestion/application/process-gmail-sync.use-case.ts`
- `packages/finance/src/ingestion/application/retry-pending-reverses.use-case.spec.ts`
- `packages/finance/src/ingestion/application/retry-pending-reverses.use-case.ts`
- `packages/finance/src/ingestion/application/route-extracted-email.use-case.spec.ts`
- `packages/finance/src/ingestion/application/route-extracted-email.use-case.ts`
- `packages/finance/src/ingestion/infrastructure/email-source.repository.spec.ts`
- `packages/finance/src/ingestion/infrastructure/email-source.repository.ts`

Los nombres de origen identifican la evidencia actual, no fijan una nueva
jerarquía de carpetas. Los repositorios financieros dejan de consultar
FinEmailMessage: reciben entradas normalizadas y referencias de señal.

## Finance: rescatar para IA

Conservar cifrado de tokens, schemas Zod y fixtures de extracción. Reemplazar
la orquestación; las credenciales y fuentes nuevas pertenecen a IA.

- `packages/finance/src/ingestion/application/ports/email-transaction-extractor.port.ts`
- `packages/finance/src/ingestion/infrastructure/ai-email-transaction.extractor.spec.ts`
- `packages/finance/src/ingestion/infrastructure/ai-email-transaction.extractor.ts`
- `packages/finance/src/ingestion/infrastructure/token-encryption.util.spec.ts`
- `packages/finance/src/ingestion/infrastructure/token-encryption.util.ts`

## Finance: retirar superficie de fuente

Retirar estos adaptadores/settings/DTOs y sus pruebas específicas cuando se
complete la separación anterior. Mantener fixtures financieros útiles en el
nuevo dueño y mantener pruebas de ausencia de los endpoints retirados.

- `packages/finance/src/ingestion/application/bank-email-fixtures.spec.ts`
- `packages/finance/src/ingestion/application/bank-sender.spec.ts`
- `packages/finance/src/ingestion/application/bank-sender.ts`
- `packages/finance/src/ingestion/application/email-message-outcome.ts`
- `packages/finance/src/ingestion/application/email-source-view.ts`
- `packages/finance/src/ingestion/application/email-source.service.spec.ts`
- `packages/finance/src/ingestion/application/email-source.service.ts`
- `packages/finance/src/ingestion/application/enqueue-due-gmail-syncs.use-case.spec.ts`
- `packages/finance/src/ingestion/application/enqueue-due-gmail-syncs.use-case.ts`
- `packages/finance/src/ingestion/application/gmail-sync-queue.service.ts`
- `packages/finance/src/ingestion/application/gmail-sync-schedule.spec.ts`
- `packages/finance/src/ingestion/application/gmail-sync-schedule.ts`
- `packages/finance/src/ingestion/application/gmail-sync.constants.ts`
- `packages/finance/src/ingestion/application/ingestion.flows.spec.ts`
- `packages/finance/src/ingestion/application/oauth-client-redirect.spec.ts`
- `packages/finance/src/ingestion/application/oauth-client-redirect.ts`
- `packages/finance/src/ingestion/infrastructure/email-message-retention.scheduler.spec.ts`
- `packages/finance/src/ingestion/infrastructure/email-message-retention.scheduler.ts`
- `packages/finance/src/ingestion/infrastructure/gmail-api.util.spec.ts`
- `packages/finance/src/ingestion/infrastructure/gmail-api.util.ts`
- `packages/finance/src/ingestion/infrastructure/gmail-auto-sync.scheduler.ts`
- `packages/finance/src/ingestion/infrastructure/gmail-sync.processor.ts`
- `packages/finance/src/ingestion/ingestion.module.ts`
- `packages/finance/src/ingestion/presentation/dto/connect-email-source.dto.ts`
- `packages/finance/src/ingestion/presentation/dto/oauth-callback-query.dto.ts`
- `packages/finance/src/ingestion/presentation/dto/update-email-source.dto.ts`
- `packages/finance/src/ingestion/presentation/email-sync.controller.ts`

## IA: retirar chat y runtime actual

Antes del borrado, rescatar las garantías de claims/confirmación/cancelación
concurrente y las pruebas que las caracterizan. No se mantiene activo el chat.

- `packages/ai-agent/src/actions/application/ai-actions-reaper.service.ts`
- `packages/ai-agent/src/actions/application/ai-actions.service.spec.ts`
- `packages/ai-agent/src/actions/application/ai-actions.service.ts`
- `packages/ai-agent/src/actions/presentation/ai-actions.controller.ts`
- `packages/ai-agent/src/chat/application/ai-agent.runner.spec.ts`
- `packages/ai-agent/src/chat/application/ai-agent.runner.ts`
- `packages/ai-agent/src/chat/application/ai-chat-turn-coordinator.service.spec.ts`
- `packages/ai-agent/src/chat/application/ai-chat-turn-coordinator.service.ts`
- `packages/ai-agent/src/chat/application/ai-sessions.service.spec.ts`
- `packages/ai-agent/src/chat/application/ai-sessions.service.ts`
- `packages/ai-agent/src/chat/application/build-system-prompt.spec.ts`
- `packages/ai-agent/src/chat/application/build-system-prompt.ts`
- `packages/ai-agent/src/chat/infrastructure/ai-chat-persistence.service.spec.ts`
- `packages/ai-agent/src/chat/infrastructure/ai-chat-persistence.service.ts`
- `packages/ai-agent/src/chat/infrastructure/ai-sessions.repository.spec.ts`
- `packages/ai-agent/src/chat/infrastructure/ai-sessions.repository.ts`
- `packages/ai-agent/src/chat/presentation/ai-sessions.controller.ts`
- `packages/ai-agent/src/chat/presentation/ai.controller.ts`
- `packages/ai-agent/src/chat/presentation/dto/ai-provider-info.dto.ts`
- `packages/ai-agent/src/chat/presentation/dto/ai-providers-response.dto.ts`
- `packages/ai-agent/src/chat/presentation/dto/chat-context.dto.ts`
- `packages/ai-agent/src/chat/presentation/dto/chat-message.dto.ts`
- `packages/ai-agent/src/chat/presentation/dto/chat-request.dto.ts`
- `packages/ai-agent/src/chat/presentation/dto/chat-response.dto.ts`
- `packages/ai-agent/src/chat/presentation/dto/create-ai-session.dto.ts`
- `packages/ai-agent/src/prompts/build-agent-prompt.spec.ts`
- `packages/ai-agent/src/prompts/build-agent-prompt.ts`
- `packages/ai-agent/src/prompts/module-context.spec.ts`
- `packages/ai-agent/src/prompts/module-context.ts`
- `packages/ai-agent/src/prompts/system-base.ts`
- `packages/ai-agent/src/prompts/tools-instructions.ts`
- `packages/ai-agent/src/runtime/application/ai-events.listener.spec.ts`
- `packages/ai-agent/src/runtime/application/ai-events.listener.ts`
- `packages/ai-agent/src/runtime/application/ai-memory.service.ts`
- `packages/ai-agent/src/runtime/application/ai-processing.processor.spec.ts`
- `packages/ai-agent/src/runtime/application/ai-processing.processor.ts`
- `packages/ai-agent/src/tools/tool-executor.dispatch.spec.ts`
- `packages/ai-agent/src/tools/tool-executor.finance-facade.spec.ts`
- `packages/ai-agent/src/tools/tool-executor.service.spec.ts`
- `packages/ai-agent/src/tools/tool-executor.service.ts`
- `packages/ai-agent/src/tools/tool.registry.spec.ts`
- `packages/ai-agent/src/tools/tool.registry.ts`

### Rescate explícito de inferencia y acciones

Los siguientes archivos requieren extracción, no borrado ciego:

- `packages/ai-agent/src/actions/infrastructure/ai-actions.repository.ts`
- `packages/ai-agent/src/chat/application/ai.service.spec.ts`
- `packages/ai-agent/src/chat/application/ai.service.ts`
- `packages/ai-agent/src/tools/tool-arg-schemas.spec.ts`
- `packages/ai-agent/src/tools/tool-arg-schemas.ts`

Se conservan providers, helpers de streaming y retry de shared. AiCoreModule,
ai.module.ts y barrels se reemplazan por composición de inferencia que permita
arrancar quick-entry y statements durante fase 0, antes del gateway de fase 1.
La tabla AiAction tiene FK obligatoria a sesión: el esquema técnico debe
resolverla antes de retirar tablas de chat; no se deja una FK huérfana.

## Consumidores que también deben adaptarse

- apps/api/src/user-data-wipe/user-data-wipe-domains.adapter.ts y su módulo:
  dejar de inyectar AiSessionsService y de exponer ai.sessions mientras no haya
  conversaciones. Conservar el vaciado por ramas del resto de dominios.
- packages/finance/src/shared/application/wipe-finance-user-data.use-case.ts,
  shared/domain/finance-data-branches.ts y deletion-snapshot.ts: retirar solo
  finance.emailMessages y los accesos FinEmail; preservar comercios y el resto
  de ramas. Coordinar el cambio de contrato con web.
- finance.facade.ts, finance.module.ts, ingestion.module.ts y ledger.module.ts:
  retirar wiring de fuente y mantener los casos de uso financieros compilables.
- ledger/application/ports/ledger.repository.port.ts, commands/ledger.commands.ts,
  ledger/infrastructure/prisma-ledger.repository.ts, prisma-ledger-read.repository.ts,
  prisma-ledger-write.repository.ts y prisma-ledger-email-import.repository.ts:
  sustituir referencias FinEmail, sin cambiar reglas de movimiento/saldo.
- analytics/application/weekly-summary.service.ts y catalog/infrastructure/catalog.repository.ts:
  retirar lecturas de email pendiente y dependencias de IngestionService.
- shared/application/finance-ownership.service.ts y los resolvedores de contexto:
  conservar ownership financiero; retirar fuente y tipos ChatContextEntity.
- packages/core/src/events/event.constants.ts y domain-events.ts, listeners de
  IA/Notifications y notification-copy.ts: retirar eventos/copy exclusivos de
  sincronización Gmail junto con la fuente; conservar `FINANCE_TRANSACTION_IMPORTED`,
  que representa un resultado financiero y no requiere tablas `FinEmail*`.
- packages/users/src/application/users.service.ts y domain/defaults/user-settings-defaults.ts,
  packages/config/src/email-sync-schedule.ts y env.schema.ts: retirar settings
  Gmail y registrar settings propios de cada dominio.
- packages/notifications/src/infrastructure/email-sync.processor.ts se conserva:
  entrega EMAIL por Resend, no sincroniza Gmail. Su cola email-sync también permanece.
- quick-entry/infrastructure/ai-quick-entry.extractor.ts y
  statements/infrastructure/ai-statement.extractor.ts siguen operativos; el puerto
  `INFERENCE_COMPLETION` tiene implementación de inferencia incluso sin chat.
- scripts/finance/dedupe-existing.ts, postman.json, swagger-spec.json, seeds y
  mocks de E2E: revisar referencias a tablas, endpoints y eventos retirados.

## Esquema y SQL de baseline

Retirar FinEmailConnection, FinEmailSource, FinEmailMessage y FinEmailSyncLog,
sus enums exclusivos, FKs e índices de fuente. FinTransaction conserva monto,
moneda y tasa originales, referencias financieras e idempotencia financiera;
su emailMessageId/FK se sustituye por procedencia de señal según el diseño final.

La verificación en PostgreSQL vacío detectó defaults UUID ausentes en dos tablas de comercios (#194); la nueva migración aditiva los alinea con Prisma. El reset debe conservar también esa corrección.

El [manifest SQL](03-BASELINE-SQL-INVENTORY.json) guarda ruta y SHA-256 de cada
migración inspeccionada. Una baseline generada solo desde Prisma es insuficiente.
Debe preservar, verificando equivalencia en PostgreSQL:

- extensiones y defaults UUID;
- triggers de updated_at y alta de usuario desde auth.users;
- funciones, CHECKs, índices parciales y restricciones que no estén en Prisma;
- grants/RLS y revocaciones de #169, sin volver a abrir PostgREST al cliente;
- políticas/bucket de logos, incluyendo reconciliar diferencias con validación;
- lease del outbox y unicidad de recibos por evento/consumidor.

No se cambia ningún SQL aplicado. El reset futuro solo está permitido en
repo/DEV tras verificar PROD de solo lectura. Nunca ejecutar reset contra una
URL obtenida implícitamente de .env para una demo o una prueba.

## Estado después del corte de código

- `@personal-os/contracts`, el runtime de inferencia independiente de chat,
  los adaptadores financieros del puerto neutral y el baseline local están
  implementados en `refactor/ai-0`.
- El historial de chat, Gmail y sus ramas de borrado ya no se publican desde
  API ni web. La importación financiera probada queda sin callers hasta AI-11.
- La fuente AiEmail/corpus, evidencia/revisión, conocimiento/proyección y el
  puente Signals → BullMQ siguen siendo fases futuras del roadmap.
- El cliente web tiene su corte inicial en `512b0dc`; el checkout de trabajo es
  `personal-os-web` en la misma rama. No se tocan `docs/handoff/` ni la imagen
  protegida de marca.

## Ejecución y gates restantes

1. Confirmar el corte PROD 0.55.3 con el owner (2026-10-24). El preflight PROD
   se recibió y auditó en modo readonly; no se hicieron escrituras remotas.
2. Baseline, SQL complementario, Prisma schema y branches de wipe están
   implementados. `migrate deploy`, drift y 18 validaciones corrieron contra
   PostgreSQL local desechable; esto no sustituye Supabase DEV.
3. No se requiere diagnosticar OAuth para retirar el flujo. El incidente queda
   documentado como no atribuible sin logs operativos.
4. Las reglas financieras conservadas mantienen pruebas de caracterización;
   los gates de build, unit, E2E y PostgreSQL real se ejecutan en esta rama.
5. Jarvin confirmó que los datos DEV son de prueba y autorizó resetearlos sin
   dump, backup ni restauración. El 2026-10-24 se validó la conexión al proyecto
   DEV `knqfgybflkpzplkqcocz` y se ejecutó el reset más la baseline. PROD no se
   tocó.
6. Conservar el SHA anterior para rollback de código. No hay rollback de datos:
   la pérdida de los datos de prueba está aceptada; un rollback solo devuelve un
   binario compatible con el esquema que exista.
7. La verificación estructural DEV encontró 45 tablas `public` con RLS, 23
   policies, 18 checks, 4 índices parciales, 4 módulos, 31 categorías y un perfil
   Auth reconciliado. La migración `20261101090004_auth_user_delete_cascade`
   limpia el perfil y sus filas dependientes al borrar directamente una identidad
   Auth; una prueba transaccional verificó alta y eliminación del perfil y revirtió
   el usuario sintético. El smoke de API contra DEV pasó para Auth, settings,
   Finance, notificaciones, marcas y wipe; las rutas chat/Gmail dan 404. Workers
   reiniciados y readiness 200 con Redis Docker local. No había jobs pendientes
   para probar leases. Se limpiaron en Railway DEV solo las claves terminales de
   `gmail-sync` y los metadatos de `ai-processing`. El deploy/reapertura del API
   Railway DEV queda pendiente; PROD no se tocó.
