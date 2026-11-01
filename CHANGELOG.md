# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y [SemVer](https://semver.org/lang/es/). Reglas y ejemplo en [docs/reference/changelog-guide.md](./docs/reference/changelog-guide.md).

## Unreleased — 0.100.0

### Agregado

- #218: la revisión agrupa los correos por remitente y plantilla con total, pendientes, pendientes HOLDOUT y asuntos de muestra; un lote `CONFIRMED` o `CORRECTED` verifica solo los pendientes fuera de HOLDOUT, es idempotente y conserva rol y secuencia por correo.
- Un ADMIN puede promover manualmente una fila GLOBAL en `REVIEW_REQUIRED` con `POST /api/intelligence/knowledge/admin/:id/promote`: registra una verificación `CONFIRMED`, la deja `STABLE` con `promotedBy: ADMIN` y el rebuild conserva la decisión; una reversión posterior vuelve a bloquearla (#246).
- Cada conexión de Gmail conserva el último intento de sincronización (inicio, fin, resultado, código y categoría, correos importados y fase) y el último fallo por separado; el dashboard los expone como `lastAttempt` y `lastFailure`, un intento correcto no borra el fallo anterior y un reinicio queda como `INTERRUPTED` (#251).
- Seeds de Knowledge para QA en DEV (#207, #327): crean evidencia de correo (mensajes, dataset, verificaciones, observaciones, consentimiento y reversiones ADMIN) y ejecutan la proyección real; las filas USER/GLOBAL sobreviven a un rebuild y conservan los estados promovidos, pendientes y bloqueados.
- Seed de la cuenta QA `qa-user@personal-os.dev` (#207): correo verificado, sin rol ADMIN, conocimiento personal `STABLE`/`OBSERVED` y evidencia GLOBAL `STABLE`/`REVIEW_REQUIRED`/`BLOCKED`; la contraseña aleatoria se guarda fuera del repositorio.
- El deploy del back corre `prisma migrate deploy` como pre-deploy de Railway (`railway.json`): si una migración falla, el deploy se cancela y sigue la versión anterior; DEV lo aplica en cada deploy y producción al mergear a `master` con el OK de Jarvin (#230).
- AI-4 (#207): conocimiento USER/GLOBAL reconstruible desde evidencia y consentimiento con cortes `REPEATABLE READ`, saneamiento estructural, cola ADMIN, exportación JSON y borrado con lápidas; `AI_GLOBAL_MIN_CONTRIBUTORS` controla el mínimo de colaboradores.
- AI-3 (#206): dataset `EMAIL_V1` con particiones deterministas, cola privada de revisión, verificaciones humanas append-only con roles/secuencia y verdad de referencia HOLDOUT; runs capturan versiones y watermarks, y el detalle de correo expone su procedencia.
- AI-2 (#205): roles de IA por usuario y consentimiento revocable; conexión OAuth Gmail de solo lectura con tokens cifrados, bootstrap desde 2026-01-01, polling incremental, recuperación acotada por cursor, correo aislado por usuario, detalle con contenido canónico/saneado/crudo y purga según retención DEV/PROD.
- AI-1: gateway de inferencia estructurada con fallback por respuesta inválida, telemetría minimizada con HMAC y retención de 90 días; Quick Entry y extractos bancarios validan antes de devolver resultados. Diagnóstico disponible con `pnpm ai:diagnostic`.

### Cambiado

- Revertir una promoción GLOBAL bloquea solo esa clave y ya no reconstruye toda la proyección; el siguiente rebuild conserva la decisión y las demás filas no cambian (#235).
- El roadmap maestro marca AI-4 como cerrado, enlaza los contratos de la oleada A (FIN-0 #242, PLATFORM-EVENTS-0 #243, PLATFORM-SETTINGS-0 #244 y NOTIF-0 #245) y registra la promoción manual ADMIN en #246 (#193).
- AI-4 (#207): el reinicio del corpus anonimiza verificaciones y observaciones en lugar de borrarlas; los runs afectados indican reproducción `INCOMPLETE` y conteos de evidencia retirada.
- #217: la verificación humana de correo valida tipos y dominios cerrados, relevancia de seguridad y datos estructurados de transacción; Swagger publica los valores permitidos.
- Gmail mantiene visible el tiempo de espera por cuota con reintentos de 5, 10 y 20 segundos cuando el proveedor no indica otro plazo (#205, #318).
- Si los reintentos rápidos no liberan la cuota, Gmail permanece en espera con una próxima reejecución automática persistida y su cuenta regresiva (#205, #318).

- AI-2 (#205): progreso de Gmail persistente y en vivo por usuario; muestra etapas, reintentos, próxima ejecución y causas seguras, permite reconectar y reiniciar el corpus desde 2026-01-01.
- AI-3 (#206): filtros de revisión por partición y Todos con conteos de pendientes; la paginación conserva filtro y orden cronológico.
- AI-3 (#206): Intelligence agrupa correo, revisión y análisis en pestañas; presenta cobertura, fechas extremas y particiones como badges, y lista los mensajes desde el más antiguo.
- AI-3 (#206): la cola de revisión también muestra los correos del más antiguo al más reciente, usando su fecha recibida.
- Cada fase AI-0 a AI-12 tiene su issue, enlazado como sub-issue del programa (#193); el roadmap maestro y los diseños de AI-0 y AI-1 apuntan a su issue y el Project 3 fija estado y prioridad de cada fase.

- El diagnóstico local de AI-1 muestra proveedor/modelo, intentos, código normalizado y estado HTTP de los SDK sin exponer errores crudos; permite probar cada proveedor por separado.
- El pool de inferencia usa Groq y OpenRouter; se retira OpenCode, cuyo modelo gratuito no admite llamadas desde el SDK del backend. Groq usa `qwen/qwen3.8-27b`.
- AI-2 (diseño): se define polling incremental programado de Gmail con cursor persistido, recuperación idempotente y Pub/Sub opcional; no es requisito para el release `0.100.0`.
- AI-0 integrado en `develop`: `@personal-os/contracts` reúne interfaces y tokens neutrales; el pool de inferencia y sus pruebas salen de chat. Los extractores financieros usan `INFERENCE_COMPLETION` y conservan sus respuestas y reglas (#193).
- El corte de runtime elimina chat, sesiones, Gmail Finance y su configuración. Queda preservada y probada la lógica de importación financiera hasta AI-11; la entrega de correo por Resend sigue operativa.
- La baseline conserva SQL manual, RLS/grants, triggers y el índice parcial de transferencias. Se aplicó en DEV junto con el reset autorizado de datos de prueba; PROD no recibió escrituras.
- La eliminación directa de un usuario en Supabase Auth elimina ahora su perfil de `public.users` y los datos de aplicación sujetos a sus FKs en cascada. El endpoint propio conserva su borrado app-first con outbox.

### Cambiado

- Se reescribe el README con banner, módulos, arquitectura, arranque, scripts y enlaces a los repos hermanos; se añade licencia MIT y archivos de comunidad (CONTRIBUTING, SECURITY y plantilla de PR).

### Corregido

- El reinicio del corpus de Gmail devuelve 409 `GMAIL_NOT_CONNECTED` sin conexión y 409 `GMAIL_SYNC_IN_PROGRESS` mientras el sync está activo o esperando cuota; no borra nada en esos casos y los códigos quedan en Swagger (#225).
- El arranque sin configuración OAuth de Gmail registra una advertencia sin secretos y deja apagado el ciclo automático; el diagnóstico expone `missing_oauth_configuration` hasta que las variables se corrigen y el API reinicia (#253).
- La recuperación de Gmail cubre todo el intervalo desde la última sincronización correcta, sin el límite de siete días, y pagina hasta terminar; si el proveedor no completa el hueco, el estado conserva el rango intentado y el intento no se informa como éxito completo (#252).
- Gmail conserva la causa real de sus fallos y reintenta la lectura del historial: la falta de configuración OAuth queda como `configuration` con `gmail_oauth_not_configured`, un 401/403 como `authorization`, un 429/5xx como `rate_limit` o `temporary`, y un código no reconocido se conserva para que la pantalla muestre una causa concreta; un reinicio del API sigue marcando `worker_interrupted` (#250).
- AI-4 (#239): revocar el consentimiento marca GLOBAL en `REVIEW_REQUIRED` y reconstruye la proyección en la misma solicitud; si el rebuild falla, la revocación y la pausa se conservan.
- AI-4 (#238): una etiqueta `SECURITY_ALERT` ya no se auto-promueve a GLOBAL; queda en revisión ADMIN aunque cumpla el umbral y el mínimo de colaboradores.
- El seed de QA genera la contraseña con las cuatro clases de caracteres que exige Supabase (minúscula, mayúscula, dígito y símbolo) en 24 caracteres, con `randomInt` y mezcla Fisher-Yates; antes la cadena base64url podía salir sin alguna clase y Supabase la rechazaba con `weak_password` (#207).
- El rebuild de Knowledge usa una transacción de 120 s: el límite anterior de 5 s abortaba en DEV con el corpus actual (#207).
- La documentación de AI-4 refleja el umbral GLOBAL aprobado (2/3 y mínimo configurable sin atajo por rol), el esquema implementado y el estado real de los tickets y PRs (#207).
- En dev, el CORS de la API y del gateway de notificaciones acepta los previews de rama de Vercel mediante `CORS_ORIGIN_PATTERNS`, una lista de patrones anclados que en production no se acepta. `CORS_ORIGIN` y su primer valor para armar enlaces no cambian, y un origen no permitido responde sin cabeceras CORS en vez de 500 (#222).

## [0.55.3] - 2026-10-24

### Cambiado

- Diseño técnico de AI-0 con baseline candidata de 44 modelos, SQL complementario, contratos neutrales, inventario de archivos back/web, preflight OAuth/Supabase y procedimiento de reconstrucción y rollback DEV (#193). Los artefactos pasan 16 comprobaciones PostgreSQL locales y comparación Prisma sin drift; no se inicia el reset ni se cambia producción.

## [0.55.2] - 2026-10-24

### Corregido

- El outbox recupera entregas con lease vencido, impide que un worker antiguo cierre otro intento y confirma recibos junto con efectos PostgreSQL. Notifications persiste antes del aviso WebSocket; IA deduplica el encolado por evento sin confirmar antes de Redis (#192).
- Las tablas de alias y descartes de duplicados de comercios reciben los defaults UUID que ya declaraba Prisma, eliminando el drift al migrar una base vacía sin tocar datos existentes (#194).
- El build de paquetes selecciona los nueve paquetes también desde scripts en Windows.

### Cambiado

- Decisiones e inventario del reset actualizados: conservación de lógica financiera, contratos neutrales, exclusiones de consentimiento, revisión de promociones y reproducción incompleta tras borrar evidencia. Se documenta la excepción condicional de 0.100.0 unreleased; el reset todavía no comienza (#193).
- CI añade integración PostgreSQL con rollback, concurrencia y procesos terminados antes/después del commit del consumidor.

## [0.55.1] - 2026-10-23

### Corregido

- Documentación: `catalog.md`, `events.md` y la guía de `users` hablan de ramas de datos (`requestedBranches`/`appliedBranches`) en lugar de las capas retiradas, y el contrato de `GET /api/users/me/data/branches` lista las ramas finales de Finanzas (#184, #185, #186).

## [0.55.0] - 2026-10-23

### Agregado

- Cada línea de `GET /api/finance/balance-sheet` trae `entity`: la cuenta, tarjeta, préstamo o cobro completo con su institución (nombre, logo y color), para que la web pinte su card canónica sin pedir cada producto (#187).
- `POST /api/finance/entities/lookup`: hasta 50 referencias `{ type, id }`, devueltas en el mismo orden con la forma pública de su endpoint, `null` en la posición de una que ya no existe o es de otro usuario, y una consulta por tipo (#188).
- Las cuentas y tarjetas exponen `institutionColor` (#187).
- `POST /api/finance/merchants` crea un comercio a mano con nombre, categoría y hasta 20 alias; el 409 de nombre repetido incluye `existingMerchantId` (#173).
- Los comercios aprenden la categoría de sus movimientos (`categorySource`: `MANUAL`, `LEARNED` o `KEYWORD`); `suggest` la devuelve con su origen, una categoría a mano nunca se pisa y la importación por correo la usa antes del historial (#174).
- Los alias reconocen comercios (`fin_merchant_aliases`, clave normalizada única por usuario), `PATCH` acepta `aliases` y la fusión conserva nombre, alias, categoría y logo del origen (#176).
- `normalizeMerchant` pliega acentos y «Ñ», ignora el sufijo web y el plural de la primera palabra; `GET /api/finance/merchants/:id/duplicates` propone hasta 5 candidatos con su motivo y la lista añade `possibleDuplicates` (#177).
- `POST`/`DELETE /api/finance/merchants/:id/duplicates/:otherId/dismiss` descartan y revierten un par como «no es duplicado» (#183).
- Los comercios eligen logo por marca: `domain`, `logoPath` y `customLogoPath`, con `DELETE /api/finance/merchants/:id/logo`; `logoUrl` se resuelve con la prioridad propio → marca → legado (#175).
- `GET /api/users/me/data/branches`: cada app declara sus ramas con su conteo y lo que arrastran. El vaciado por ramas sustituye a las capas, acepta `expectedCounts` y responde 409 sin borrar si un conteo cambió (#184).
- Finanzas se vacía por ramas finas: conciliaciones, movimientos, saldos, tarjetas, cuentas, instituciones, suscripciones, recurrentes, comercios, correos importados, estados de cuenta, préstamos, metas, cobros, presupuestos, categorías y conexiones de Gmail (#185, #186).
- El chat de IA usa bloques `entity_card` y `entity_list` que solo guardan la referencia; la web pide los datos al consultar en lote (#188).

### Corregido

- Un aporte, retiro o abono con fecha elegida se registra en el día local del usuario, no el anterior, y conserva la hora actual cuando la fecha es hoy (#189).
- Un aporte a una meta o un abono a capital ya no anuncia además su movimiento interno: el usuario recibe un solo aviso (#190).

### Cambiado

- Contrato: `POST /api/users/me/data/wipe` recibe `branches` (antes `layers`) y responde `requestedBranches`/`appliedBranches`; las capas antiguas desaparecen.
- Contrato: los bloques `transaction_card`, `transaction_list`, `budget_progress` y `loan_summary` del chat se reemplazan por `entity_card` y `entity_list`.
- Contrato: `PATCH /api/finance/merchants/:id` deja de aceptar `logoUrl` libre (responde 400) y acepta `aliases` y `domain`.

## [0.54.3] - 2026-10-22

### Cambiado

- Interno: un solo helper mapea el presupuesto con su gastado y el fin del día del periodo se define una vez en el dominio compartido; la lista de movimientos y la suma del gastado usan el mismo rango (#172). Sin cambio de comportamiento.

## [0.54.2] - 2026-10-22

### Corregido

- El gastado de un presupuesto se suma al leer desde sus movimientos del periodo, así que la lista, el detalle, el hero de Planificación, el aviso del formulario de gasto y el estado de presupuestos de analytics muestran la misma cifra y no la de un contador guardado (#172).
- El contador guardado deja de alimentar lo que ve el dueño de la cuenta; sigue disparando las alertas de umbral (#172).

## [0.54.1] - 2026-10-22

### Corregido

- `GET /api/finance/receivables`, el detalle de un cobro y su edición entregan `creditBalance` y `writtenOffAmount` como texto decimal en vez de un objeto (#166).
- Los pagos de un cobro entregan `amount`, `appliedAmount` y `excessAmount` como texto decimal; antes solo `amount` lo era (#166).

## [0.54.0] - 2026-10-22

### Agregado

- Proveedor de IA `OpenCode` con el modelo gratuito `deepseek-v4.1-flash-free`: entra en la cadena cuando existe `OPENCODE_API_KEY` y responde chat con streaming y tool calls (#170).

### Cambiado

- La cadena de respaldo de IA pasa a ser Groq → OpenCode → OpenRouter; si un proveedor agota su cuota, falla o responde 429, el chat sigue con el siguiente (#170).
- El error de arranque por falta de proveedores nombra `GROQ_API_KEY`, `OPENCODE_API_KEY` y `OPENROUTER_API_KEY` (#170).

### Eliminado

- Cerebras sale de la cadena de IA, del entorno, de las dependencias y de la documentación; `CEREBRAS_API_KEY` deja de leerse (#170).

## [0.53.3] - 2026-10-22

### Agregado

- Interno: `.infisical.json` y `pnpm env:pull` traen las variables locales del proyecto `personal-os`; `docs/operations/environment.md` documenta que Infisical es la fuente de verdad y que Railway se llena por sync (#168).

### Cambiado

- Interno: `.env.example` deja `OPENCODE_API_KEY` comentada hasta #170 y conserva documentadas las claves de Sentry y los límites de IA que ya existían (#168).

### Corregido

- Las peticiones sin cabecera `Origin` (abrir `/api/docs` en el navegador, el favicon, curl) pasan sin cabeceras CORS en vez de responder 500 con `Origin header is required`; los orígenes fuera de `CORS_ORIGIN` siguen rechazados en non-prod.

## [0.53.2] - 2026-10-22

### Cambiado

- El push Android (FCM) se configura con `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` y `FIREBASE_PRIVATE_KEY` separadas; la clave acepta saltos de línea reales o `\n` literales, y si falta alguna el canal queda apagado y la API arranca igual (#167).

### Eliminado

- `FIREBASE_SERVICE_ACCOUNT_JSON` y `FIREBASE_SERVICE_ACCOUNT_PATH` salen del código, del esquema `Env` y de `.env.example`; si siguen definidas, se ignoran (#167).

## [0.53.1] - 2026-10-21

### Cambiado

- Interno: el alta del préstamo nombra el paso del desembolso y deja la orquestación separada de la acreditación. Sin cambio de comportamiento.

## [0.53.0] - 2026-10-21 - Préstamos y metas

### Agregado

- `POST /api/finance/loans` acepta `name` y `disbursementAccountId`: el capital entra a esa cuenta con un `ADJUSTMENT` que no cuenta como ingreso y queda ligado por `disbursementTransactionId` (#181, #182).
- `GET /api/finance/loans` y `GET /api/finance/loans/:id` devuelven `name` y `disbursementAccount` (#182).
- `POST /api/finance/savings-goals/:id/allocations` con `kind: WITHDRAWAL` mueve el dinero a `toAccountId` y guarda `destinationAccountId`; borrar el retiro revierte la transferencia (#188).

### Cambiado

- Crear o editar una meta de ahorro valida que la cuenta exista y esté en la moneda de la meta (#189).
- Archivar una cuenta con dinero apartado en una meta responde 409 `ACCOUNT_HAS_GOAL_MONEY` (#189).

## [0.52.0] - 2026-10-21 - Monedas

### Agregado

- `GET /api/finance/balance-sheet` agrega `byCurrency` en `global` y en cada institución, con totales nativos por moneda sin conversión (#178, #183).
- `GET /api/finance/subscriptions/summary` agrega `byCurrency` con costo mensual, costo anual y cantidad activa por moneda (#178).

### Cambiado

- Los totales por moneda de instituciones y suscripciones ya no dependen de una única cifra convertida a la moneda base.

## [0.51.1] - 2026-10-21

### Cambiado

- Interno: el balance sheet acumula sus incidencias en las líneas locales en vez de mutar un parámetro. Sin cambio de comportamiento.

## [0.51.0] - 2026-10-21 - Patrimonio

### Agregado

- `GET /api/finance/balance-sheet` devuelve `breakdown.byCurrency` con una línea por producto (cuentas, efectivo, cobros, tarjetas y préstamos), totales nativos y en moneda base, y `breakdown.totals` con Disponible, Por cobrar, Deudas y Patrimonio (#163).
- Cada línea trae `hasDrift`, `driftDifference` y el estado de conciliación del mes, además de límite y crédito disponible en las tarjetas (#163).
- Los cobros `PENDING`/`PARTIAL` no vencidos o vencidos hace 90 días o menos suman al patrimonio; los vencidos hace más de 90 días se devuelven como dudosos y no suman (#163, #207).
- El Swagger del balance sheet documenta el desglose y los campos nuevos (#163).

### Cambiado

- El patrimonio neto incluye los cobros vigentes. `global.assets` agrega `cash` y `receivables`; `totalAssets` y `netWorth` los reflejan. La decisión queda en el ADR-005 de la web (#207).

## [0.50.0] - 2026-10-21

### Agregado

- El perfil guarda el primer día de la semana en `preferences.regional.weekStartsOn`: domingo, lunes, sábado o automático desde el locale (#223).
- Script `db:backfill-week-starts-on` para copiar al perfil el día que estaba guardado en Finanzas o Agenda (#223).

### Cambiado

- `PATCH /users/me` valida `locale` como etiqueta BCP-47 y rechaza un `weekStartsOn` distinto de 0, 1, 6 o null (#223).

## [0.49.0] - 2026-10-21

### Agregado

- Una tarjeta con varias monedas y ninguna coincidente responde 400 `CARD_CURRENCY_UNDECLARED` con el motivo, en vez de abrir un balance nuevo (#161).

### Cambiado

- Un movimiento en una moneda que la tarjeta no declara se convierte a la moneda que la tarjeta ya tiene, con la tasa del día; el monto original, la moneda original y la tasa quedan guardados. Agregar la moneda al producto deja de ser obligatorio (#161).
- Una tarjeta de débito aplica la moneda de su cuenta en el ledger, no la del movimiento (#161).

### Corregido

- Ya no aparece un balance en la moneda de la compra cuando la tarjeta tiene una sola moneda, así que el descuadre por esa moneda desaparece (#161).

## [0.48.0] - 2026-10-21

### Agregado

- El perfil acepta una zona horaria IANA y la rechaza con el error en el campo cuando no existe o no tiene forma de zona (por ejemplo `+04:00`), no solo por longitud (#162).

### Cambiado

- `transactionDate` en movimientos, transferencias y pagos de tarjeta exige un instante con zona (`Z` u offset). Una hora de reloj sin zona se rechaza en vez de leerse en la zona del servidor (#211).

## [Sin publicar]

### Agregado

- Paquete de contexto del rediseño de IA en `docs/refactors/personal-os-ai-redesign-context-pack/` (00–12): visión, estado actual, decisiones e invariantes, arquitectura objetivo (Inference Gateway, Capability Registry, Signals, Action Policy), conocimiento con evidencia append-only y alcance GLOBAL/USER, Email Intelligence V1, roadmap de 13 fases (0–12) con pruebas, demo y gate por fase, modelo de datos, capa de roles (USER | CONTRIBUTOR | ADMIN), impacto en back y web, y decisiones del dueño registradas. Solo documentación; no cambia el comportamiento.
- Skill `archify` en `.agents/skills/archify/` (registrada en `skills-lock.json`) y diagramas generados en `.archify/` (arquitectura, ERD de finanzas, ingesta de correo, ledger, estado de cuenta, releases, monorepo, sync de Gmail, resumen semanal).
- En desarrollo, la API sirve los diagramas de `.archify/` como estáticos en `/docs/diagramas/`; en producción no se montan.
- Convenciones de issues en `docs/issue-conventions.md` y plantillas `.github/ISSUE_TEMPLATE/bug.yml` y `feature.yml`.
- Convenciones de issues: regla contra issues espejo entre repositorios y secciones «Notas técnicas» y «Definición de terminado» en `docs/issue-conventions.md` y en las plantillas `feature.yml` y `bug.yml`.

### Cambiado

- `AGENTS.md` y `docs/README.md` enlazan las convenciones de issues y la nueva documentación.

## [0.47.2] - 2026-10-20

### Cambiado

- Interno: el servicio de comercios separa `resolve` del texto derivado y `resolveTyped` del texto escrito, con un helper privado que recibe un objeto. Sin cambio de comportamiento (#159).

## [0.47.1] - 2026-10-20

### Corregido

- El comercio creado desde un movimiento conserva el nombre tal como lo escribió el usuario, sin re-capitalizarlo. La clave normalizada sigue uniendo las variantes y la ingesta de correo mantiene su nombre limpio (#159).

## [0.47.0] - 2026-10-20

### Agregado

- Push a Android por Firebase Cloud Messaging: los avisos llegan al móvil con la app cerrada. Web Push mantiene su canal y los tokens de iOS se ignoran sin error porque no hay cuenta de Apple Developer (jarvinc3/personal-os-back#137).

### Cambiado

- El 403 de una app apagada nombra la app en lugar de su identificador interno, y el decorador `RequiresEnabledModule` sigue siendo el hueco que cualquier app nueva reutiliza al montar sus controladores (jarvinc3/personal-os-back#136).
- Interno: el repositorio del ledger se parte en lectura, escritura, borrado y restauración, importación de correo y aviso de movimiento; el catálogo separa las categorías, y la ingesta separa las fuentes de correo y la cola de sincronización (jarvinc3/personal-os-back#149).

## [0.46.3] - 2026-10-20

### Cambiado

- Interno: el borrado, la restauración y el aviso de eliminación del ledger salen de `prisma-ledger.repository.ts` a `prisma-ledger-deletion.repository.ts`, y la reversa de los enlaces de planificación a `planning-link-reversal.ts`; el repositorio principal delega. Sin cambio de contrato ni de comportamiento (jarvinc3/personal-os-back#149).

## [0.46.2] - 2026-10-20

### Cambiado

- Interno: `reverseTransactionsByTransferGroupId` ya no devuelve un conteo; el puerto declara `Promise<void>` y la reversa queda como comando sin valor de retorno. Sin cambio de comportamiento.

## [0.46.1] - 2026-10-20

### Cambiado

- Interno: las consultas y búsquedas del ledger salen de `prisma-ledger.repository.ts` a `prisma-ledger-read.repository.ts`; el repositorio principal delega el listado y las lecturas. Sin cambio de contrato ni de comportamiento (jarvinc3/personal-os-back#149).

## [0.46.0] - 2026-10-20

### Agregado

- `POST /api/finance/transfers/:id/reverse` reversa todas las patas de una transferencia completada, devuelve saldo y presupuesto y las deja `REVERSED`. Responde 409 `TRANSFER_NOT_COMPLETED` si alguna pata no está completada.

### Corregido

- El listado lógico incluye los pagos de tarjeta como una operación `TRANSFER` y resuelve el destino por `legRole`, así que aparecen en Movimientos y en el historial de la cuenta y la tarjeta (#176).

## [0.45.0] - 2026-10-20

### Agregado

- Las transferencias entre monedas aceptan `exchangeRate` (tasa par origen→destino) o `receivedAmount` (monto que entra en la cuenta destino). El monto recibido manda si vienen ambos. Sin ninguno se usa la tasa del día y la operación queda marcada como estimada. El detalle devuelve monto enviado, monto recibido, tasa y la marca (#157).

## [0.44.0] - 2026-10-20

### Corregido

- La lista de cuotas y el plan de amortización de un préstamo entregan `amount`, `principal`, `interest`, `insurance`, `fees`, `lateFee` y `paidAmount` como texto decimal. Antes solo `amount` llegaba como texto y el resto viajaba como objeto, así que la web no podía calcular la amortización y el detalle del préstamo fallaba (#156). Cambio de formato incompatible con clientes anteriores, en beta.

## [0.43.2] - 2026-10-19

### Cambiado

- Interno: `shareUrl()` separa la resolución de la base (`PUBLIC_WEB_URL` o el primer `CORS_ORIGIN`) de la ruta, y las pruebas reutilizan la URL esperada. Sin cambio de comportamiento (#155).

## [0.43.1] - 2026-10-19

### Agregado

- `PUBLIC_WEB_URL` en el env schema: URL opcional de la web pública; se ignora si viene en blanco (#155).

### Corregido

- El link de un cobro compartido se arma con `PUBLIC_WEB_URL` en vez del primer origin de `CORS_ORIGIN`: create, list, revoke y regenerate devuelven `https://<web>/c/<token>`. Sin `PUBLIC_WEB_URL` se conserva el fallback anterior (#155).

## [0.43.0] - 2026-10-18

### Agregado

- `POST /api/finance/savings-goals/:id/allocations` acepta `fromAccountId`: si la cuenta de origen no es la de la meta, valida su saldo libre, crea la transferencia y guarda `transferGroupId` + `transactionId`.

### Cambiado

- Borrar un aporte con transferencia enlazada borra también el movimiento que creó; antes la transferencia quedaba en el ledger.
- Una transferencia entre cuentas propias genera un solo aviso «Transferencia registrada» desde la cuenta de origen; antes cada pata avisaba como gasto o ingreso.
- `PATCH /api/finance/savings-goals/:id` acepta `targetDate: null` para quitar la fecha objetivo; antes solo se podía cambiar por otra.

### Corregido

- Un aporte desde otra cuenta ya no deja la cuenta de origen en negativo: si el saldo libre no alcanza, responde `EARMARK_EXCEEDS_BALANCE`.

## [0.42.1] - 2026-10-17

### Cambiado

- Interno: el backfill de cuentas planifica antes de escribir y deja de mutar su contador; el scheduler de retención separa la consulta de ids del borrado en lote. Sin cambio de comportamiento (#139).

## [0.42.0] - 2026-10-17

### Agregado

- `fin_accounts.account_number_last4` y `fin_accounts.account_number_hash`: la API expone `accountNumberLast4` en las respuestas de cuentas y el hash HMAC conserva la unicidad `(user_id, institution_id)` sin descifrar (#139).
- `pnpm db:encrypt-account-numbers` cifra las filas de `fin_accounts` que sigan en texto plano con `DATA_ENCRYPTION_KEY` y completa `last4`/hash. Idempotente; se corre una vez por entorno tras `db:migrate:deploy` (#139).
- Retención de `fin_email_messages.extracted_payload`: `EmailMessageRetentionScheduler` lo pone en NULL a los 30 días, a diario y por lotes, conservando la fila para dedup; las transacciones no se tocan (#139).
- `ai_actions.user_id` (desde su sesión) y `ai_actions.created_at` para auditoría (#139).
- `fin_budgets.updated_at` y `fin_email_sources.updated_at` (#139).

### Cambiado

- `fin_accounts.account_number` se guarda cifrado (AES-256-GCM con `DATA_ENCRYPTION_KEY`, distinta de la clave de tokens de Gmail). Las respuestas ya no devuelven el número completo; en edición, omitir `accountNumber` conserva el guardado y enviarlo lo recifra (#139).
- El match de correos a cuentas usa `accountNumberLast4`; dos cuentas de la misma institución con el mismo last4 quedan ambiguas (#139).
- `fin_budgets` suma el índice único `(user_id, category_id, period_start)` y el check `period_end >= period_start`; la base DEV no tenía duplicados (#139).

## [0.41.0] - 2026-10-16

### Agregado

- Links públicos de solo lectura para cobros compartidos: `POST/GET /api/finance/receivable-shares`, `PATCH /api/finance/receivable-shares/:id/revoke` y `PATCH /api/finance/receivable-shares/:id/regenerate`, más `GET /api/public/receivable-shares/:token` sin auth, con `X-Robots-Tag: noindex` y 30 peticiones por minuto y por IP. El token es aleatorio (base64url, 256 bits) y el conjunto de cobros queda fijo al crear. El payload público no expone cuentas, instituciones, transacciones, ids internos ni el email del dueño, y agrupa los montos en `totalsByCurrency` sin convertir monedas (#154).

### Cambiado

- `description` de un cobro es obligatoria al crear por `POST /api/finance/receivables` (trim, 1-120); `PATCH` aplica las mismas reglas cuando viene, y las filas ya existentes con `description` nula siguen válidas. El concepto de un cobro compartido usa `description` o, si falta, `Cobro del <d MMM>` con el día de creación (#154).

## [0.40.3] - 2026-10-16

### Corregido

- `Idempotency-Key` en `POST /api/finance/email-sync/sources/:id/sync`: cuando la petición agota el timeout de 8 s, la clave ya no se libera y queda `IN_PROGRESS` hasta su TTL, porque el trabajo puede seguir vivo y un reintento encolaría un sync duplicado (#153).
- El sync manual de Gmail usa el `jobId` estable `gmail-sync-{sourceId}` (también con `forceFullSync=true`), así que un reintento en vuelo no encola un segundo job (#153).

### Cambiado

- `IdempotencyKeyRetentionScheduler` borra a diario (03:00) las claves de idempotencia vencidas, por lotes, en vez de esperar a que se reusen (#153).

## [0.40.2] - 2026-10-16

### Cambiado

- Los E2E cargan `AppModule` al abrir cada archivo, fuera del `beforeEach`: la transpilación en frío de ts-jest se comía el timeout de 5 s del hook en CI (#150). Sin cambio de comportamiento.
- Umbrales globales de cobertura: 70 % de statements, 69 % de líneas, 51 % de funciones y 58 % de ramas; antes 25/25/19/20 (#147).

### Agregado

- Tests de comportamiento y ramas de error para el chat de IA, el ejecutor de tools, la ingesta de correo y el repositorio del ledger (#148). La cobertura global sube de 65.21 % a 69.34 % de líneas y de 53.89 % a 58.22 % de ramas.

## [0.40.1] - 2026-10-16

### Cambiado

- ESLint 9.39.5 → 10.12.0 y `@eslint/js` 9.39.5 → 10.0.1. La regla nueva `preserve-caught-error` obliga a adjuntar la causa: `ResendEmailAdapter.send` relanza el fallo de `fetch` con `{ cause: error }` y el mismo mensaje.
- `typescript-eslint` 8.71.0 → 8.71.2, `eslint-plugin-prettier` 5.5.6 → 5.5.7, `prettier` 3.9.9 → 3.9.10, `pino-pretty` 13.1.3 → 13.2.0 y `ts-jest` 29.4.14 → 29.4.15.
- `@supabase/supabase-js` 2.117.2 → 2.118.0 y `zod` 4.6.5 → 4.6.7.

## [0.40.0] - 2026-10-16

### Agregado

- Tool de IA `reverse_transaction`: el agente puede revertir una transacción `CONFIRMED` y deshacer sus efectos de saldo y presupuesto. Delega en `FinanceFacade.reverseTransaction`.

### Cambiado

- CI: `pnpm audit --prod --audit-level=high` deja de bloquear el pipeline (`continue-on-error`).
- `pnpm build` corre `prisma generate` antes de compilar, para que un clon sin el cliente generado compile igual.

### Eliminado

- `packages/database/src/generated/` y `tsconfig.tsbuildinfo` dejan de versionarse; se regeneran con `pnpm db:generate` (o `pnpm build`).

## [0.39.2] - 2026-10-16

### Cambiado

- `AGENTS.md` agrega la regla de migraciones Prisma: una migración aplicada no se renombra ni se edita; toda migración nueva ordena después de `20261022110000`; el duplicado `20261015220000` se queda tal cual; el reset que ofrece `prisma migrate dev` no se acepta.

## [0.39.1] - 2026-10-16

### Cambiado

- `PATCH /api/users/me/release-notes-seen`: el comando que persiste la versión vista ya no arma el perfil; el controlador ejecuta el comando y consulta el perfil con `findById`. La respuesta no cambia.

## [0.39.0] - 2026-10-16

### Agregado

- `PATCH /api/users/me/release-notes-seen` guarda en `users.last_seen_release_version` la última versión de Novedades vista por el usuario. Migración `20261022110000_user_last_seen_release_version`.
- `GET /api/users/me` devuelve `lastSeenReleaseVersion`, nullable hasta la primera visita.

## [0.38.1] - 2026-10-16

### Cambiado

- `IdempotencyInterceptor`: la consulta de la clave ya no borra la fila vencida; el borrado es una orden aparte y la respuesta guardada se resuelve con una consulta pura. Sin cambio de comportamiento.

## [0.38.0] - 2026-10-16

### Agregado

- Idempotencia de peticiones: un interceptor global lee `Idempotency-Key` en POST, PATCH y DELETE, guarda la respuesta de la primera ejecución en `idempotency_keys` (TTL 24 h) y la reproduce en los reintentos. La misma clave con otro body o ruta responde 409; una clave en curso responde 409; un error libera la clave para permitir el reintento.
- Migración `20261022100000_idempotency_keys`.

### Cambiado

- CORS: `Idempotency-Key` entra en los headers permitidos y se quitan `x-business-id` y `x-organization-id`, que no se usaban.

## [0.37.6] - 2026-10-16

### Corregido

- Migración `20261022000000_db_functions_triggers`: el trigger `on_auth_user_created` ahora solo se crea si existe la tabla `auth.users` (`to_regclass`), no solo el esquema `auth`. El CI simula `auth` sin `auth.users` y fallaba `prisma migrate deploy`.

## [0.37.5] - 2026-10-16

### Agregado

- Migración `20261022000000_db_functions_triggers`: `update_updated_at()` y un trigger `trg_<tabla>_updated_at` en todas las tablas de `public` con columna `updated_at`, más `handle_new_user()` y el trigger `on_auth_user_created` sobre `auth.users`. Antes existían solo en prod, creados a mano; ahora cualquier base nueva (dev incluida) queda igual.

## [0.37.4] - 2026-10-16

### Cambiado

- La documentación deja de llevar `status.md`, `review-register.md` y `roadmap.md`: el estado, el roadmap y los hallazgos viven en GitHub Issues (label `roadmap`) y los documentos cerrados pasan a `docs/archive/`.
- `docs/modules/logos/overview.md` absorbe la integración de Logo.dev (llaves, bucket, flujo y casos borde).
- `AGENTS.md`, `docs/README.md` y `docs/documentation-standard.md` describen el flujo de issues con `Closes #N`, Sentry/source maps y CI con migraciones y drift.

### Agregado

- `docs/infrastructure/observability.md`.

### Eliminado

- El plan de Cursor de hallazgos de sync bancario y el diseño del módulo `sub_` de Suscripciones.

## [0.37.3] - 2026-10-15

### Agregado

- `pnpm sentry:sourcemaps` sube los source maps de `dist` con `@sentry/cli` cuando existe `SENTRY_AUTH_TOKEN`; sin token no hace nada y el build no falla. `pnpm build` lo ejecuta al final.

### Cambiado

- `AllExceptionsFilter.reportToSentry` recibe un objeto en vez de tres parámetros.

## [0.37.2] - 2026-10-15

### Corregido

- Las pruebas e2e esperan el formato paginado `{ items, nextCursor, hasMore }` en las listas de cuentas, tarjetas y préstamos, y los mensajes de error en español.
- `moduleDisabledMessage` responde en español.

## [0.37.1] - 2026-10-15

### Corregido

- `instrument.ts` importa `dotenv/config` antes de leer `process.env`, para que un `SENTRY_DSN` guardado en `.env` se aplique.
- Se quita un `as T` innecesario en el scrubber que rompía `lint`.

## [0.37.0] - 2026-10-15

### Agregado

- Observabilidad con Sentry (`@sentry/nestjs`): `Sentry.init` en `instrument.ts`, importado en la primera línea de `main.ts`, con `environment`, `release`, `tracesSampleRate` y un scrubber que borra body, cookies, cabeceras de auth y tokens. Sin `SENTRY_DSN` no se inicializa.
- `AllExceptionsFilter` reporta a Sentry solo los 5xx; los 4xx no se envían.
- Variables opcionales de Sentry en `env.schema`; `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` y `SENTRY_PROJECT` solo sirven para subir source maps y su ausencia no rompe el build.
- ADR-007: la API no lleva prefijo de versión (`/v1`) mientras web y back se desplieguen juntos.

### Cambiado

- Paginación por cursor en cuentas, tarjetas, instituciones, préstamos, metas de ahorro y cobros.
- Desactivar un token push pasa a `DELETE /notifications/push-tokens/:token`; el PATCH anterior queda como alias deprecado.
- `GET /finance/analytics/bank-charges` se monta en `GET /finance/bank-charges` (patrón `finance/<recurso>`); las acciones de IA quedan en `ai/sessions` y `ai/actions`.
- Todos los mensajes de excepción y los resúmenes de Swagger pasan a español.
- El CI corre `format:check` además de lint, build y tests.
- `docs/modules/finance/contracts/http.md`, `docs/infrastructure/config.md` y las capacidades de finanzas quedan al día.

### Eliminado

- `tmp-bhd-balances.mjs`.
- La excepción de CORS que permitía peticiones sin `Origin` (Expo).

## [0.36.1] - 2026-10-15

### Corregido

- `PORT` cae a 3100 en `main.ts`, igual que `env.schema` y `.env.example`; antes el fallback decía 3000.
- `MAX_EMAIL_LLM_EXTRACTS` y `AI_DAILY_INSIGHT_QUOTA` aceptan una variable vacía y usan el default, en vez de romper el boot.

## [0.36.0] - 2026-10-15

### Agregado

- `finance.email_sync.failed` se encola en el outbox cuando un sync de correo falla, en la misma transacción que el log `FAILED` del sync.
- `pnpm smoke:finance`: smoke HTTP de 16 endpoints clave de finanzas contra `SMOKE_BASE_URL` con `SMOKE_ACCESS_TOKEN`.

### Cambiado

- `LoggingInterceptor` queda activo como interceptor global; se borran `RolesGuard` y `@Roles` sin uso.
- `MAX_EMAIL_LLM_EXTRACTS` y `AI_DAILY_INSIGHT_QUOTA` entran en `env.schema` (defaults 25 y 20).
- El puerto por defecto unifica en 3100, igual que `.env.example`.
- Saneamiento del registro de revisión (pendiente 17): `review-register.md` y la documentación de finanzas, config y eventos al día; los hallazgos sin código pasan a GitHub Issues (label `roadmap`).

### Eliminado

- El comando `db:reconcile-balances`, que apuntaba a un script inexistente.

## [0.35.0] - 2026-10-15

### Agregado

- `GET /api/finance/recycle-bin` incluye `logoUrl` de la institución en los registros eliminados: lo lee del snapshot para una institución y lo resuelve por `institutionId` para una cuenta.

## [0.34.0] - 2026-10-15

### Agregado

- `GET /api/finance/recycle-bin` incluye `logoUrl` resuelto de la institución en los registros archivados (instituciones y sus cuentas), para que la papelera muestre la marca.

### Cambiado

- El texto que el back expone al usuario (guías de preferencias y etiquetas de acciones del agente) dice App en vez de módulo, con el glosario [docs/glosario.md](./docs/glosario.md) y la regla `.cursor/rules/module-terminology.mdc`.

## [0.33.5] - 2026-10-15

### Cambiado

- El rechazo de crear o convertir una institución en efectivo vive en un solo guard, sin repetir el mensaje.

## [0.33.4] - 2026-10-15

### Corregido

- La institución Efectivo no se puede convertir en efectivo: `PATCH` con `type: 'cash'` sobre otra institución responde 400, así cada usuario conserva una sola.
- La cuenta Efectivo de la moneda base no se puede borrar (responde 400); se desactiva, como aprobó la decisión del pendiente 16.
- El wipe `finance.catalog` ya no borra la institución de sistema; `ensureCashInstitution` repone la cuenta base cuando falta, de modo que Efectivo se vacía pero no se borra.

## [0.33.3] - 2026-10-15

### Cambiado

- Limpieza interna sin cambios de comportamiento: imports relativos y formato de Prettier en los paquetes de finanzas.

## [0.33.2] - 2026-10-15

### Cambiado

- El comando que asegura la institución Efectivo ya no devuelve el id. La cuenta de efectivo lee la institución con la consulta del repositorio después de asegurarla, siguiendo la separación comando/consulta del resto de finanzas.

## [0.33.1] - 2026-10-15

### Corregido

- La migración del efectivo crea el índice único de la institución de sistema solo con SQL. Declararlo en el esquema obligaba a activar la vista previa `partialIndexes`, que hacía a Prisma marcar como drift tres índices parciales previos.

## [0.33.0] - 2026-10-15

### Agregado

- Cada usuario tiene una institución de sistema «Efectivo» (`is_system`) con una cuenta por moneda. Se crea sola al listar instituciones o cuentas y por el backfill de la migración `20261021110000_fin_cash_institution`.
- Resumen de efectivo en el balance general (`cash`): total convertido a la moneda base, desglose por moneda y cuenta, y estado `INCOMPLETE` con total nulo cuando falta una tasa. Las cuentas sin tasa no tumban el balance general; se marcan con `MISSING_RATE`.
- Las cuentas de efectivo nuevas y las existentes sin institución se asignan a Efectivo. El back rechaza editar, archivar o borrar la institución de sistema, y crear tarjetas, préstamos o fuentes de correo ligados a ella. Las respuestas de institución incluyen `isSystem`.

### Cambiado

- Toda cuenta exige institución: el check de `fin_accounts` pasa a `institution_id IS NOT NULL`.

## [0.32.4] - 2026-10-15

### Corregido

- E2E de finanzas: el archivado de tarjeta mockea el perfil del usuario que aporta la fecha local, y el resumen de analytics usa un `Prisma.Decimal` real como saldo. Los mocks anteriores devolvían 404 y `DecimalError` al no cumplir el contrato de los datos.

## [0.32.3] - 2026-10-22

### Cambiado

- `pnpm lint:money` cubre además `merchants/application` y `merchants/infrastructure`.

### Corregido

- Recurrentes: el costo equivalente mensual y anual de un patrón se calcula con `Prisma.Decimal` y `ROUND_HALF_EVEN` (`monthlyAmount`, `annualAmount`), en vez de aritmética de `Number` con `toFixed`.
- Comercios: el gasto del mes conserva la suma exacta del agregado (`Prisma.Decimal`) y se serializa como string, sin pasar por `Number`.

## [0.32.2] - 2026-10-22

### Cambiado

- `MoneyLike` acepta `null` como único monto ausente y deja fuera `undefined`; `toMoney` y el chequeo de límite ausente del balance general usan esa única convención.

## [0.32.1] - 2026-10-22

### Cambiado

- `MoneyLike` documenta que un monto ausente (`null` de un agregado, `undefined` de un campo opcional) es cero, un solo significado; el spec separa ese caso del parseo de strings.
- El resumen semanal extrae el promedio de gastos a `averageOfAmounts`, fuera del flujo de armado del resumen.
- `pnpm lint:money` separa el escaneo de cada archivo (`offendersIn`) del reporte de la lista.

## [0.32.0] - 2026-10-22 - Decimales exactos

### Cambiado

- El dinero se suma, resta y convierte con `Prisma.Decimal` de punta a punta en analytics, balance general, resumen semanal, costo equivalente de suscripciones y conversión de moneda, en vez de `Number`. `shared/domain/money.ts` gana `toMoney`, `sumMoney`, `roundDecimal` (`ROUND_HALF_EVEN`), `convertDecimal`, `ratioPercent` y `scalarNumber`. Las respuestas siguen como strings (ADR-002) y el redondeo a 2 decimales ocurre solo al presentar o persistir.
- El repositorio de analytics lee la suma como `numeric` (`::text`) y no como `::float`.

### Agregado

- Regla ESLint `no-restricted-syntax` y `pnpm lint:money` (`scripts/finance/check-money-decimals.mjs`, en CI) que prohíben `Number`/`toNumber` en las rutas de lectura de dinero.

## [0.31.1] - 2026-10-22

### Cambiado

- La constante `PENDING` vive en `shared/domain/transaction-status.ts` y el repositorio de catálogo la reutiliza, en vez de repetir el texto.
- El mapeo del disponible por moneda se extrae a `mapCardBalance`, fuera de `mapCard`.

## [0.31.0] - 2026-10-22 - Tarjetas prácticas

### Agregado

- `GET /finance/cards` y `GET /finance/cards/:id` devuelven `availableCredit` por moneda (disponible menos movimientos pendientes) y `nextStatementDate`/`nextPaymentDueDate` con la fecha local del usuario.
- Recordatorio de pago de tarjeta: `CardPaymentRemindersScheduler` y `CardPaymentRemindersService` emiten `finance.card_payment.due` dentro de `reminders.cardDueDaysBefore` (default 3), una sola vez por corte y sin avisar si ya está pagado.
- Ajuste `reminders.cardDueDaysBefore` validado (0-30) en la configuración del módulo de Finanzas.

### Cambiado

- Documentación de `statements` y `catalog` con el disponible y las próximas fechas.

## [0.30.2] - 2026-10-21

### Corregido

- Las alertas de fin de prueba y de renovación salen de la ventana global (`subscriptions.reminderDaysBefore`), no del valor guardado por suscripción, igual que el summary y los recordatorios. La migración `20261021100000_subscription_reminder_days_default` pasa a 5 los módulos que aún guardaban el default viejo (3 días) y conserva cualquier otro valor elegido a mano.

### Cambiado

- Spec: la ventana global manda en las alertas de cuenta atrás.

## [0.30.1] - 2026-10-21

### Cambiado

- El descarte masivo de alertas del repositorio deja de devolver el resultado de la escritura, que nadie leia: el cuerpo de la respuesta de la API no cambia.

## [0.30.0] - 2026-10-21 - Suscripciones v3

### Agregado

- Alerta `AMOUNT_MISMATCH`: el último cobro no coincide con el monto esperado de la suscripción, por arriba o por abajo, sin duplicar la subida de precio ya confirmada. Migración `20261021090000_fin_subscription_amount_mismatch`.
- `POST /finance/subscriptions/alerts/dismiss-all`: marca de una vez todas las alertas activas.
- La lista de suscripciones devuelve `lastChargeMismatch` y `lastPaymentAmount` para la marca de advertencia de la card.
- La lista acepta `categoryIds`, `frequency` (`MONTHLY`, `YEARLY`, `OTHER`) y `sort` (`NEXT_DATE`, `AMOUNT`, `NAME`); el cursor sigue el orden elegido.
- `summary.reminderWindowDays`: la ventana de próximos cobros sale del ajuste global.

### Cambiado

- `subscriptions.reminderDaysBefore` pasa de 3 a 5 por defecto y se valida entre 1 y 30.
- La lista de suscripciones expone y aplica los filtros y el orden en el servidor, para que la paginación por cursor no corte resultados.
- Los recordatorios de renovación usan el ajuste global en vez del valor guardado por suscripción, que deja de mostrarse en la UI (la columna se conserva).
- `decodeCursor` acepta un validador de clave, para las listas que ordenan por otra columna.

## [0.29.1] - 2026-10-20

### Corregido

- El check de integridad refresca `storedBalance`, `expectedBalance` y `difference` de una desviación abierta aunque la diferencia no cambie, para no mostrar cifras viejas; el aviso solo se repite cuando cambia la diferencia.

### Cambiado

- Specs de integridad: transferencia con comisión, restauración tras borrado, refresco de una desviación abierta, repositorio (solo movimientos `CONFIRMED` y corrección en una transacción) y validaciones de `GET check` y `POST recalculate`.

## [0.29.0] - 2026-10-20 - Integridad de saldos

### Agregado

- `GET /finance/integrity/check`: recalcula el saldo esperado de cada cuenta y tarjeta desde sus movimientos confirmados, registra las desviaciones abiertas y acepta `accountId` o `cardId`.
- `POST /finance/integrity/recalculate`: corrige el saldo guardado a la suma de sus movimientos y cierra la desviación en una misma transacción, sin crear movimientos.
- `BalanceIntegrityScheduler` nocturno y evento `finance.balance.drift_detected`; aviso controlado por `notifications.balanceIntegrity`.
- Modelo `FinBalanceDrift` y migración `20261020120000_fin_balance_drifts`.
- Specs del dominio (secuencia mixta de todos los tipos de movimiento), del servicio, del scheduler y e2e de detección y recálculo.

## [0.28.2] - 2026-10-19

### Corregido

- La lista de suscripciones acepta `unassignedCategory` y `unassignedMethod` para filtrar las que no tienen categoría ni método de pago.
- El historial de pagos de cada suscripción se ordena por fecha e id, para que la alerta de subida de precio compare siempre los mismos dos cargos.

## [0.28.1] - 2026-10-19

### Cambiado

- Specs del registro y del ejecutor de tools que cubren `get_subscriptions_summary` y `get_subscription_alerts`.

## [0.28.0] - 2026-10-19

### Agregado

- `GET /finance/subscriptions/breakdown`: costo mensual en moneda base agrupado por categoría, tarjeta-cuenta o moneda.
- `GET /finance/subscriptions/upcoming`: cobros proyectados en una ventana de días o un rango, con todas las ocurrencias de los ciclos semanales.
- `GET /finance/subscriptions/alerts`: subida de precio, prueba por vencer, renovación anual y cobro sin registrar, con descarte persistido por tipo, suscripción y fecha.
- `GET /finance/subscriptions/summary` añade el costo del mes anterior, la tendencia, el gasto real del mes y del anterior, los detectados pendientes y el ahorro anual de las canceladas.
- Las suscripciones guardan categoría (`category_id`, FK a `fin_categories`) y la lista incrusta `paymentMethod` y `category`; filtros nuevos `categoryId`, `cardId` y `accountId`.
- Tools `get_subscriptions_summary` y `get_subscription_alerts`.
- Migración `fin_subscriptions_categories_alerts`: columna e índice de categoría y tabla de descartes de alertas.

## [0.27.2] - 2026-10-19

### Corregido

- La sugerencia de impuesto DGII usa solo las salidas en la moneda del producto, no las de todas las monedas de una tarjeta.
- El cargo DGII sugerido nunca supera la diferencia que explica.
- Conciliar una tarjeta de débito responde 404: su saldo se cierra desde la cuenta enlazada, y el estado del mes ya no lista esas tarjetas.
- La fecha de corte del cierre es opcional y por defecto es hoy.

### Cambiado

- El desglose mensual de cargos bancarios va en orden cronológico y `groupBy` devuelve solo el grupo pedido.
- Specs del filtro por moneda, del tope del DGII, de la fecha por defecto y del agrupado.

## [0.27.1] - 2026-10-19

### Cambiado

- Specs de las tools de conciliación: parámetros derivados del esquema de `reconcile_product`, ruteo del preview y de la confirmación con la sugerencia, lectura de `get_bank_charges` y rechazo de un `reconcile_product` sin exactamente un producto destino.

## [0.27.0] - 2026-10-19 - Conciliación

### Agregado

- Tablas `fin_reconciliations` y `fin_reconciliation_adjustments` con el enum de tipos de ajuste, las categorías de sistema de cada tipo y sus índices y llaves foráneas.
- REST `/finance/reconciliations`: `preview`, alta con sus ajustes en una transacción de BD, historial por producto, detalle, borrado del último cierre, `restore` y `status` del mes.
- `GET /finance/analytics/bank-charges`: total de cargos bancarios por mes, institución y tipo.
- Tools `reconcile_product` (vista previa y confirmación) y `get_bank_charges`.
- Los ajustes de conciliación mueven el saldo, no aparecen en el tablero ni en presupuestos, y se borran y restauran con el diario de borrados (`entityType` `reconciliation`).

## [0.26.1] - 2026-10-14

### Corregido

- `PATCH /finance/subscriptions/:id` con `status: ACTIVE` recalcula `nextBillingDate` desde hoy, igual que el endpoint `resume`.
- El emparejado de pagos compara días de calendario y no horas transcurridas: un cobro el día esperado a las 23:00 entra en la ventana de ±3 días.
- Registrar a mano un pago con un movimiento ya vinculado a la misma suscripción responde 409 en vez del error del índice único.
- Pausar, reanudar o cancelar limpia el sello del estado contrario (`pausedAt`/`cancelledAt`).
- Editar el dominio a `null` ya no rompe la actualización de la suscripción.

### Cambiado

- Specs del servicio de suscripciones (reanudar, emparejado de una sola candidata, pago manual duplicado) y del job de recordatorios (un evento por ciclo).

## [0.26.0] - 2026-10-14 - Suscripciones

### Agregado

- Tablas `fin_subscriptions` y `fin_subscription_payments` con enums de ciclo de facturación, estado y origen del pago, y sus índices y llaves foráneas.
- REST `/finance/subscriptions`: listado y alta, detalle y edición, `pause`, `resume`, `cancel`, `payments`, `logo` y `summary` (costo mensual y anual en la moneda base).
- Emparejado automático de pagos tras persistir o importar un movimiento, con el puerto `SUBSCRIPTION_MATCHER`, y job diario de recordatorios que emite `FINANCE_SUBSCRIPTION_RENEWAL_DUE`.
- Tools `create_subscription` y `confirm_subscription_payment`; `list_subscriptions` incluye las suscripciones gestionadas.

### Cambiado

- Suscripciones deja de ser un módulo: sale de `MODULE_SLUGS` y de `MODULE_CONTEXT`, su configuración vive en el bloque `subscriptions` de Finanzas y una migración borra sus filas de `modules` y `user_modules`.
- `PATCH /users/me/modules/:slug` responde 400 con un slug retirado como `subscriptions`.

## [0.25.2] - 2026-10-14

### Corregido

- El aviso de subida de precio de un recurrente confirmado vuelve a dispararse en cada ejecución: la detección usa una banda amplia solo para refrescar el patrón y deja intacta la tolerancia guardada que compara el último cobro.
- `GET /finance/recurring` pagina hacia delante con el cursor; la lista ordena por próximo cobro ascendente y antes repetía filas ya vistas.
- El gasto del mes de un comercio cubre el último día completo, y `GET /finance/merchants/:id` usa la ventana del mes en vez del histórico.
- Editar el nombre de un recurrente resuelve el comercio canónico, así que el cambio se ve en la lista y el detalle.
- `POST /finance/recurring` rechaza un alta sin comercio ni `merchantId`, y `nextExpectedDate` se valida como fecha ISO en alta y edición.

### Cambiado

- Se eliminan métodos de repositorio sin uso (`listTransactions` y `clearMerchantLinks` de comercios, `deletePatterns` de recurrentes). Sin cambios de comportamiento.
- Specs nuevos para el cursor del repositorio de recurrentes, el gasto del mes, la tolerancia del aviso de precio y la edición del comercio.

## [0.25.1] - 2026-10-14

### Cambiado

- La detección de recurrentes devuelve el aviso de subida de precio en vez de mutar la lista del llamador. Sin cambios de comportamiento.

## [0.25.0] - 2026-10-14 - Comercios y suscripciones detectadas

### Agregado

- Comercios canónicos: `FinMerchant` con clave normalizada y alias, `FinTransaction.merchantId` y el normalizador puro `normalize-merchant.ts` (gateway, referencias, estrella, ciudad y descriptores) con specs a partir de los correos BHD, Popular y Qik.
- REST de comercios: `GET /finance/merchants`, `GET /finance/merchants/:id`, `GET /finance/merchants/suggest`, `PATCH /finance/merchants/:id`, `POST /finance/merchants/:id/merge` y `POST /finance/merchants/:id/logo`.
- Recurrentes: `FinRecurringPattern` gana `merchantId`, `status`, `kind`, `lastSeenAt`, `amountTolerance`, `confirmedAt` y `createdAt`; detección pura por comercio, monto (±10 %) y periodicidad (7, 14, 30 o 365 días), con scheduler nocturno que respeta los descartados.
- REST de recurrentes: `GET /finance/recurring`, `GET /finance/recurring/upcoming`, `POST /finance/recurring` y `PATCH /finance/recurring/:id` (confirmar, descartar, editar).
- Eventos `finance.recurring.price_changed`, `finance.recurring.missed` y `finance.recurring.upcoming`, con su notificación en la app y el ajuste `recurringAlerts` de Finanzas.
- Tools `list_subscriptions`, `confirm_recurring` y `list_merchants`.
- La creación manual y la ingesta de correo resuelven y guardan el `merchantId`; `merchant` conserva el texto original.

### Cambiado

- `GET /finance/transactions` acepta el filtro `merchantId` y cada movimiento devuelve `merchantId`, `merchantName` y `merchantLogoUrl`.

## [0.24.4] - 2026-10-14

### Corregido

- El resumen semanal incluye todo el domingo: la consulta de gasto usa el último instante del último día de la semana en vez de su medianoche.

### Cambiado

- El spec del resumen semanal comprueba el límite del último día de la semana. Sin cambios de comportamiento.

## [0.24.3] - 2026-10-14

### Corregido

- La captura rápida rechaza una fecha imposible del modelo (por ejemplo `2026-02-31`) en el extractor, en vez de reemplazarla en silencio por la fecha de hoy. La validación vive en el borde que interpreta al modelo y el servicio confía en el contrato del puerto.

### Cambiado

- El spec del extractor de captura rápida cubre la fecha válida, la ausente y la imposible. Sin cambios de comportamiento aparte del rechazo.

## [0.24.2] - 2026-10-14

### Corregido

- La notificación del resumen semanal reporta la semana anterior completa, no la que acaba de empezar el mismo día del envío.
- `GET /api/finance/analytics/weekly-summary` responde 400 ante un `weekStart` que no es una fecha real (por ejemplo `2026-02-31`) en vez de fallar con un error interno.
- La captura rápida ignora una fecha imposible del modelo y usa la fecha de hoy.

### Cambiado

- Los specs cubren el día y la hora del envío semanal, la idempotencia por semana, los destinatarios según el ajuste, el texto de la notificación, la semana anterior y las fechas imposibles. Sin cambios de comportamiento.

## [0.24.1] - 2026-10-14

### Corregido

- El bloque de movimiento del chat ya no rellena tipo, monto, moneda, fecha ni estado que falten: un movimiento incompleto se omite en lugar de mostrar un valor inventado. La cuota del préstamo y el porcentaje del presupuesto se derivan solo de los datos presentes.

## [0.24.0] - 2026-10-14

### Agregado

- El chat del agente responde con bloques nativos de Finanzas: `transaction_card`, `transaction_list`, `budget_progress`, `loan_summary` y `chart`. El runner los arma desde las tools de lectura (el LLM no da forma a las cifras) y se guardan con el mensaje; los clientes viejos ignoran los tipos que no conocen.
- `POST /api/finance/quick-entry/parse` convierte una frase corta en un borrador de movimiento (tipo, monto, moneda, categoría, cuenta o tarjeta, fecha y comercio) con salida estructurada del LLM, resuelve alias contra el catálogo del usuario (por nombre, institución o últimos dígitos) y nunca guarda.
- `GET /api/finance/analytics/weekly-summary` devuelve el gasto de la semana frente al promedio de las cuatro anteriores, el top 3 de categorías, los presupuestos en riesgo, las próximas cuotas, los vencimientos de tarjeta y los correos pendientes.
- Un scheduler emite el resumen semanal por el outbox de notificaciones el día elegido, a las 08:00 de la zona del usuario, con idempotencia por semana.

### Cambiado

- La configuración de Finanzas suma `notifications.weeklySummary` (encendido por defecto) y `reports.weeklySummaryDay` (lunes por defecto).

## [0.23.2] - 2026-10-14

### Corregido

- El prompt de sistema acota el nombre y el resumen de la entidad en foco, para que una descripción de banco larga no infle el prompt.

### Cambiado

- El spec del contexto de entidad cubre todas las ramas de resolución (transferencia, cuenta, tarjeta, cuota, cobro, meta, institución, correo y vencimiento ausente). Sin cambios de comportamiento.
- El spec del repositorio de catálogo pasa el diario de eliminación que exige el constructor. Sin cambios de comportamiento.

## [0.23.1] - 2026-10-14

### Cambiado

- Leer y guardar el contexto de la sesión son operaciones separadas. Sin cambios de comportamiento.

## [0.23.0] - 2026-10-14

### Agregado

- `POST /api/ai/chat`, `POST /api/ai/chat/stream` y `POST /api/ai/sessions` aceptan `context` (`ChatContext`: `moduleSlug`, `screen?`, `entityRef?: { type, id }`).
- El agente resuelve la entidad en foco con la fachada de Finanzas (dueño validado por `userId`) y suma tipo, nombre, saldo/estado e id al prompt de sistema. La sesión guarda el último `context` (`ai_agent_sessions.chat_context`).

## [0.22.2] - 2026-10-14

### Corregido

- Un cursor paginado con forma válida pero con una fecha inválida responde 400 en vez de fallar en la consulta.

### Cambiado

- `GET /api/finance/budgets` desempaca el cursor con el helper compartido, igual que el resto de las listas. Sin cambios de comportamiento.

## [0.22.1] - 2026-10-14

### Cambiado

- Los repositorios de planificación, correo y papelera comparten un helper para desempacar el cursor. Sin cambios de comportamiento.

## [0.22.0] - 2026-10-14

### Agregado

- `GET /api/finance/loans/:id/installments`, `GET /api/finance/receivables/:id/payments`, `GET /api/finance/savings-goals/:id/allocations` (y su alias `/contributions`), `GET /api/finance/email-sync/pending` y `GET /api/finance/email-sync/messages` aceptan `cursor` + `limit` (1-100, por defecto 20) y devuelven `{ items, nextCursor, hasMore }`.
- Los eliminados de `GET /api/finance/recycle-bin` paginan por fecha dentro de `{ archived, items, nextCursor, hasMore }`.

### Cambiado

- `GET /api/finance/recycle-bin` deja de devolver `{ archived, deleted }`: los archivados van completos en `archived` y los borrados paginan en `items`.
- La tool `list_pending_emails` pide la primera página y devuelve `hasMore`.

## [0.21.1] - 2026-10-14

### Corregido

- Subir un PDF dañado responde 400 con `STATEMENT_PARSE_FAILED` en vez de un error 500.
- Ignorar una línea ya emparejada y volver a marcarla conserva su movimiento; antes se creaba un duplicado.
- Aplicar un import de tarjeta registra el corte cerrado en el historial del instrumento, igual que el cierre manual.
- Si el worker no puede leer el PDF temporal, el import queda `FAILED` en vez de quedarse en `PARSING`.

## [0.21.0] - 2026-10-14

### Agregado

- Importar un estado de cuenta desde un PDF: `POST /api/finance/cards/:id/statements/import` y `POST /api/finance/accounts/:id/statements/import` crean el import y lo parsean en la cola `statement-import` (o en la misma petición si BullMQ no está disponible). La clave del PDF se pide y no se guarda; el archivo tampoco.
- Conciliación de un import: `GET`/`DELETE /api/finance/statement-imports/:id`, `PATCH .../lines/:lineId` y `POST .../apply`. El matcher empareja por referencia o por monto, moneda, ±3 días y texto parecido. Aplicar crea los movimientos marcados, cierra el corte de la tarjeta y ajusta la diferencia si se pide; es idempotente.
- Modelos `FinStatementImport` y `FinStatementImportLine` (migración `20261015230000_fin_statement_imports`).

## [0.20.0] - 2026-10-13 - Reinicio de versionado beta

### Cambiado

- Nuevo esquema de versiones: el proyecto está en **beta** y usa `0.MINOR.PATCH` hasta `1.0.0`. Política completa en [docs/versionado.md](./docs/versionado.md).
- Las versiones `1.x` anteriores equivalen al historial `0.x` y sus tags se borraron. `0.20.0` continúa el orden de lo publicado hasta `1.19.x`.
- Marca "beta" en el README.

> **Nota:** las entradas de abajo se publicaron como versiones `1.x` antes del reinicio de numeración. Se conservan como registro histórico; sus tags ya no existen.

## [1.19.1] - 2026-10-13

### Agregado

- `CONTEXT.md`: glosario del dominio con los términos de negocio y los sinónimos que se descartan.

### Corregido

- `statements.md` lista los seis estados reales del corte (`OPEN`, `CLOSED`, `PARTIAL`, `MINIMUM_PAID`, `PAID`, `OVERDUE`) en vez de `PENDING` | `PARTIAL` | `PAID`.
- `planning.md` incluye `WRITTEN_OFF` entre los estados del cobro.

## [1.19.0] - 2026-10-13

### Agregado

- El `module_config.finance` define el ingreso fijo y el modo de correo. Una nómina sin monto usa primero el ingreso fijo como sugerencia y, si no, la última nómina de la cuenta.
- Los movimientos importados por correo entran `PENDING` cuando el módulo está en modo pendiente.

## [1.18.0] - 2026-10-13

### Agregado

- Fixtures anonimizados de correos reales de BHD, Banco Popular y Qik (`packages/finance/test/fixtures/bank-emails/`) con una prueba de extracción por formato.
- Una nómina sin monto crea un ingreso `PENDING` con el monto de la última nómina de la cuenta como sugerencia y la fecha del correo, para que el usuario solo confirme el monto; sin nómina previa queda en la cola de monto pendiente.
- El recordatorio de pago de tarjeta de BHD (sin cifras) emite `finance.card_statement.reminder` y la app muestra un aviso para cargar el corte a mano, sin crear movimiento.

### Corregido

- Las notificaciones de nómina de Banco Popular (sin monto, y la v2 sin fecha) ya no se descartan.
- El dedupe por referencia bancaria cubre el "Número de confirmación": los dos correos del mismo pago de servicio de BHD y la copia al beneficiario de una transferencia se descartan como duplicados.

## [1.17.0] - 2026-10-13

### Agregado

- `POST /api/finance/transactions/:id/link` y `DELETE /api/finance/transactions/:id/link`: ligan un movimiento existente a una cuota de préstamo, un cobro o una meta aplicando el efecto de dominio, sin crear un movimiento nuevo, y lo revierten al quitar el vínculo. El detalle del movimiento expone `planningLink { kind, targetId, label }`.
- El abono del cobro acepta un `transactionId` existente para no crear otro movimiento.
- Tools de agente `link_transaction`, `adjust_balance`, `list_pending_emails`, `assign_pending_email`, `retry_pending_email` y `complete_pending_email_amount`.

## [1.16.0] - 2026-10-12

### Agregado

- Fase 08: huella del correo y referencia bancaria; el índice `fin_transactions_user_inst_ref_key` evita importar el mismo movimiento dos veces. Se exponen `possibleDuplicateOfId`, `merge`, `not-duplicate` y la tool `list_possible_duplicates`.
- `POST /transfers` devuelve `suggestGoalId` cuando la cuenta destino pertenece a una meta.
- `spendReducesProgress` decide si un retiro enlazado a un gasto resta del progreso de la meta.
- Rollover y recurrencia de presupuestos: `carriedOver` y `effectiveLimit` se calculan y el scheduler crea el periodo siguiente.
- `GET /budgets/:id/transactions` con cursor.
- `STATEMENT_CLOSED` en el historial de la tarjeta.
- Scripts de datos `dedupe-existing.ts` y `backfill-budget-spent.ts`, con `--dry-run`.
- Alias deprecado `POST/GET/DELETE /savings-goals/:id/contributions`.
- `GET /cards/:id/statements` pagina con cursor (`items`, `nextCursor`, `hasMore`).
- El historial de cuenta y tarjeta pagina con cursor en la base en vez de cargar todo en memoria.

### Cambiado

- `GET /cards/:id/statements` devuelve una página y no un arreglo.

### Corregido

- El desglose de cuotas del préstamo se reconstruye con la tabla francesa y el saldo baja solo por capital pagado.
- Los reversos no cuentan dos veces en analítica ni en el tablero.
- Un pago de cuota sin cuenta responde 400 `LOAN_ACCOUNT_REQUIRED` en vez de marcar la cuota pagada sin movimiento.
- El detalle del corte excluye ajustes y limita los pagos a la ventana `(cycleEnd, dueDate]`.
- El mock de Prisma incluye `finBudgetCategory` y hay e2e de las rutas nuevas.

## [1.15.0] - 2026-10-12

### Agregado

- Presupuestos multicategoría: `POST/PATCH /budgets` aceptan `categoryIds` (1..20), `name`, `includeChildren`, `rollover` y `recurring`. Si una categoría ya está en un presupuesto que se solapa en el periodo, responde 409 `CATEGORY_ALREADY_BUDGETED`.
- `amountSpent` busca los presupuestos por conjunto de categorías, incluidas las subcategorías cuando `includeChildren`.
- `GET /budgets` agrega `categories[]`, `carriedOver` y `effectiveLimit`.
- La tool `create_or_update_budget` acepta `categoryIds`.

### Cambiado

- `FinBudget` pierde el único por categoría y gana la tabla `fin_budget_categories`; los presupuestos viejos se migran a ella.

## [1.14.0] - 2026-10-12

### Agregado

- Cobros con excedente: `POST /receivables/:id/payments` acepta `excessHandling` (`EXTRA_INCOME`, `CREDIT_BALANCE`, `APPLY_TO_RECEIVABLE`) y `targetReceivableId`. Sin `excessHandling`, un pago mayor a lo pendiente responde 422 `RECEIVABLE_EXCESS_UNRESOLVED` con `details: { outstanding, excess }`.
- `POST /receivables/:id/write-off` cierra el cobro como `WRITTEN_OFF` con `writtenOffAmount`, sin movimiento.
- La categoría del sistema "Ingreso extra" (`systemKind=EXTRA_INCOME`) recibe la parte excedente cuando se elige `EXTRA_INCOME`.

### Cambiado

- El cobro guarda `creditBalance`, `writtenOffAmount` y `writtenOffAt`; el pago guarda `appliedAmount`, `excessAmount` y `excessHandling`. El saldo del cobro suma `appliedAmount`.

## [1.13.0] - 2026-10-12

### Agregado

- La meta de ahorro vive en una cuenta (`accountId` obligatorio) y tiene `mode` (`EARMARK` por defecto) y `spendReducesProgress`.
- `POST /savings-goals/:id/allocations` aparta o retira dinero sin crear movimiento; `GET` y `DELETE /allocations` con cursor. Si el apartado supera el saldo libre de la cuenta responde 409 `EARMARK_EXCEEDS_BALANCE`; sin cuenta, 400 `GOAL_ACCOUNT_REQUIRED`.
- `GET /accounts` y `/accounts/:id` agregan `earmarkedAmount` y `freeBalance`.
- Tool `allocate_to_goal` (reemplaza `record_savings_contribution`) y `create_savings_goal` exige `accountId`.

### Cambiado

- Se eliminan las rutas `/savings-goals/:id/contributions`.
- Las asignaciones guardan `kind` (`CONTRIBUTION`/`WITHDRAWAL`) y `transferGroupId`.
- Script `scripts/finance/backfill-goal-allocations.ts`, con `--dry-run`, para convertir los aportes viejos.

## [1.12.0] - 2026-10-12

### Agregado

- Préstamos con tabla francesa: cada cuota guarda `principal`, `interest`, `insurance`, `fees`, `lateFee`, `paidAmount` y `status`. El pago reparte en mora, cargos, seguro, interés y capital, y el saldo baja solo por capital.
- `POST /api/finance/loans/{id}/pay-next-installment` acepta `{ amount?, accountId?, excessAsPrepayment? }`, deja la cuota `PARTIAL` si el pago es menor y responde 400 `PAYMENT_EXCEEDS_INSTALLMENT` si sobra sin confirmar.
- `POST /api/finance/loans/{id}/prepayments` con `REDUCE_TERM` o `REDUCE_INSTALLMENT`, `GET /loans/{id}/prepayments/preview` y `GET /loans/{id}/schedule`. Errores `LOAN_HAS_OVERDUE` y `LOAN_NOT_FOUND`.
- Tools del agente `prepay_loan` y `get_loan_schedule`; `mark_loan_installment_paid` ahora usa el caso de uso real.

### Cambiado

- El préstamo guarda `rateType`, `insuranceAmount`, `lateFeePolicy`, `prepaymentPenaltyPct` y `disbursementDate`.
- Script `scripts/finance/backfill-loan-schedule.ts` para recalcular el saldo desde la tabla, con `--dry-run`.

## [1.11.0] - 2026-10-12

### Agregado

- `POST /api/finance/card-payments` (con `PATCH`, `DELETE`, `unconfirm` y `confirm`): pago de tarjeta de crédito como operación de dos patas `CARD_PAYMENT`; sube el disponible de la tarjeta y no cuenta como gasto. Errores `CARD_NOT_CREDIT`, `CARD_CURRENCY_MISSING` y `CARD_NOT_FOUND`.
- Los cortes guardan `minimumPayment`, `minimumSource` y `status` (`OPEN`, `CLOSED`, `PARTIAL`, `MINIMUM_PAID`, `PAID`, `OVERDUE`); el mínimo se estima como 1/36 del balance si no viene importado. `GET /cards/:id/statements` devuelve `minimumPayment`, `paidAmount` y `dueDate`.
- Tools del agente `pay_card` y `get_card_statement`.

### Cambiado

- Las transferencias viejas con destino tarjeta se convierten a `CARD_PAYMENT` (misma migración de datos).
- `get_finance_summary` ya no cuenta `CARD_PAYMENT` como gasto.

## [1.10.0] - 2026-10-12

### Agregado

- El diario de borrados guarda `operation_group_id`, `size_bytes` y `expires_at`; un job diario purga las entradas sin restaurar con más de 30 días.
- `GET /api/finance/recycle-bin` devuelve `sizeBytes` por eliminado, para avisar cuando restaurar puede tardar.

### Cambiado

- Restaurar una entrada ya restaurada responde 409 `ALREADY_RESTORED`; un choque con datos nuevos responde 409 `RESTORE_CONFLICT`; restaurar una sola pata de una operación agrupada responde 409 `PARTIAL_OPERATION`.

## [1.9.0] - 2026-10-12

### Agregado

- `POST /api/finance/transfers/{id}/confirm`: confirma en una sola transacción todas las patas pendientes de la transferencia.
- `DELETE /api/finance/transfers/{id}`: alias que borra la operación completa por el id de cualquiera de sus patas.
- `GET /api/finance/transactions` acepta `groupOperations`: con `true` cada transferencia vuelve como `{ kind: 'OPERATION', operationType: 'TRANSFER', legs: [...] }` con todas sus patas.

### Cambiado

- Una transferencia es solo entre cuentas: `POST /transfers` con `toCardId`/`fromCardId` responde 400 `TRANSFER_TARGET_NOT_ACCOUNT`; la misma cuenta responde 400 `SAME_ACCOUNT` y una cuenta inexistente 404 `ACCOUNT_NOT_FOUND`. La tool `create_transfer` del agente ya no acepta tarjeta como destino.
- La comisión de una transferencia ahora suma en analítica y en el presupuesto al crear la operación (antes se creaba la pata pero no se contaba).
- El listado de movimientos muestra solo la pata `SOURCE` por operación; la pata de comisión ya no aparece como fila aparte.

## [1.8.0] - 2026-10-12

### Agregado

- Transferencias con comisión opcional (`fee`), carril interbancario (`rail`: `SAME_BANK`, `ACH`, `LBTR`, `OTHER`), pata destino pendiente (`destinationPending`) y rol por pata (`legRole`).
- `POST /api/finance/transfers/{id}/unconfirm`: pasa todas las patas a `PENDING` y revierte los saldos.

### Cambiado

- Editar una transferencia se hace en una sola transacción y solo si todas las patas están `PENDING`; si no, responde 409 `TRANSFER_LOCKED`.

## [1.7.0] - 2026-10-12

### Agregado

- `POST /api/finance/transactions/{id}/unconfirm`: devuelve el saldo y el gasto del presupuesto y deja el movimiento pendiente para editarlo. La tool `unconfirm_transaction` del agente hace lo mismo.
- Cada movimiento devuelve `editable` (`FULL`, `METADATA`, `NOTES`, `NONE`); una edición bloqueada responde 409 con código `TRANSACTION_LOCKED`, `TRANSACTION_IMMUTABLE` o `TRANSACTION_LINKED`.
- `GET /api/finance/accounts/{id}/history` y `/cards/{id}/history`: ajustes de saldo y cambios de límite, con cursor.
- `GET /api/finance/transactions` acepta `includeAdjustments`; por defecto los ajustes quedan fuera del listado.

### Cambiado

- Editar un movimiento completado ya no permite cambiar monto, moneda, cuenta, tarjeta, fecha ni tipo.

## [1.6.0] - 2026-10-12

### Agregado

- `GET /api/finance/recycle-bin`: lista las instituciones, cuentas, tarjetas y préstamos archivados (`isActive:false`) y los borrados pendientes del diario, con una etiqueta visible para cada uno.

## [1.5.2] - 2026-10-12

### Corregido

- Las pruebas E2E de borrado vuelven a pasar: el mock de Prisma cubre los modelos que leen los borrados y el historial de borrados.

## [1.5.1] - 2026-10-12

### Cambiado

- La versión del build se resuelve una sola vez al arrancar, sin estado mutable dentro del getter.

## [1.5.0] - 2026-10-12

### Agregado

- `/api/health` devuelve `version`, leída del `package.json` de la raíz.

### Cambiado

- Swagger deja de mostrar `1.0` fijo y usa la versión del `package.json`.
- La documentación pasa prettier: el script de formato cubre `md` y existe `format:check`.

## [1.4.0] - 2026-10-12

### Agregado

- Deshacer un borrado: cada `DELETE` de finance guarda un snapshot en `fin_deletion_journal` y `POST /api/finance/<entidad>/:id/restore` repone las filas, los enlaces que la cascada anuló y el saldo y presupuesto revertidos.
- `PATCH /api/finance/transfers/:id` para editar una transferencia.
- El aporte a una meta de ahorro se liga a la cuenta de la que sale el dinero y crea su movimiento.

### Cambiado

- Los DTO de alta y edición de préstamo rechazan saldo mayor que el monto original, cuota menor o igual a cero y cuotas pagadas mayores que el total.
- El contexto de Finanzas del agente pide responder con un enlace a `/finance/loans/new` con los valores del préstamo.

### Corregido

- La herramienta de IA de aporte a meta no enviaba la cuenta que exige el DTO.
