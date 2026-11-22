# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y [SemVer](https://semver.org/lang/es/). Reglas y ejemplo en [docs/reference/changelog-guide.md](./docs/reference/changelog-guide.md).

## Unreleased — 0.100.0

### Agregado

- Contexto de institución en el chat del agente (personal-os-web#499): `AiInvocationEntityRefDto` acepta `entityRef.type = "institution"` y el lookup de Finanzas la resuelve con la misma forma pública que `GET /finance/institutions/:id`, así que el agente puede abrirse desde una institución sin que la conversación responda 400. El tipo también entra en `EntityReferenceDto` del lookup por lotes, porque el agente usa ese mismo camino.
- #215: ayuda proactiva por señal. Una señal enrutada que el consumidor de su dominio dejó en revisión produce como máximo una sugerencia por evento, con su origen (`signalId` y `signalType`) y un aviso interno `IN_APP`; el resto de los eventos no llama al modelo, no gasta presupuesto y no notifica. La relevancia es determinista (tipo de señal conocido y consumo en `REVIEW_REQUIRED`) y se evalúa antes de razonar. Antes de cada sugerencia se reservan el ritmo y el cupo diario de las sugerencias por vista y el tope global de 5 USD/día; sin reserva el evento se cuenta como omitido. Una acción que cambia datos solo se propone si es una capacidad `WRITE` con `CONFIRM_REQUIRED` y pasa por la política AI-10, así que nunca se aplica sola. `GET /intelligence/proactive-suggestions` lista las sugerencias del dueño y cuántos eventos quedaron fuera en la ventana vigente. Al modelo solo viajan el tipo de señal y el motivo de revisión, nunca el payload del correo.
- #421: el envío de mensajes del agente puede responder por partes. `POST /intelligence/conversations/:id/messages` acepta `stream: true` y responde SSE con `start`, `status`, `chunk`, `reset`, `done` y `error`; sin `stream` conserva el JSON. Cada envío acepta un `clientMessageId` por turno: repetirlo con el mismo contenido reutiliza el mensaje del usuario y, si el turno ya terminó, devuelve la respuesta guardada sin llamar al modelo; con otro contenido responde 409. Los mensajes internos de herramientas se guardan en una transacción al cerrar el turno, así que un corte o un fallo no deja restos parciales. La respuesta final guarda su proveedor y modelo.

- #355: `POST /intelligence/email/sample-import` deja de esperar a la corrida: valida y resuelve la selección, guarda el trabajo y responde `202` con su referencia antes de llamar al modelo. `GET /intelligence/email/sample-import/:id` devuelve el estado (`QUEUED`, `RUNNING`, `COMPLETED` o `FAILED`), el avance procesados/total y, al terminar, el manifiesto por correo. El trabajo vive en `ai_email_sample_imports`, lo ejecuta un worker de la cola `ai-email-sample-import` cuando Redis está activo y continúa en el mismo proceso cuando no, así que el proxy puede cerrar la petición inicial sin perder la corrida. Un trabajo se procesa una sola vez; repetir la selección no duplica movimientos ni señales. El estado es solo del dueño, no expone cuerpos de correo y entra en la exportación y el borrado total de datos de IA.

- #402: los límites del piloto de clasificación pasan a variables de entorno (`AI_EMAIL_*`) y dejan de exigir un despliegue para cambiarse: ritmo por minuto, carga inicial, tope diario de tokens, tope global de costo con su proporción de alerta, recorte de contenido, asunto y remitente, y la lista de bancos que llegan al modelo. Cada proveedor suma su propio contador por minuto compartido entre réplicas (`ai_provider_minutes`): la cola de correo espera al siguiente minuto antes de llegar al 80 % del RPM contratado (`AI_PROVIDER_RPM_GROQ` 30 y `AI_PROVIDER_RPM_OPENROUTER` 20) en vez de recibir un 429, y el resto de las tareas no espera para no bloquear una respuesta interactiva. Medición en DEV con 660 clasificaciones correctas: 2 655 tokens por correo (2 465 en Groq y 3 506 en OpenRouter) y unos 0.0005 USD por correo; el tope diario se expresa con esa medición.
- #414: `GET /intelligence/messages` acepta `q` y `status` junto al cursor. `q` busca en el asunto o el remitente de todo el historial importado, sin distinguir mayúsculas, y `status` filtra por `INGESTED`, `QUEUED`, `PROCESSED`, `REVIEW_REQUIRED` o `FAILED`; ambos se combinan con la paginación y con la cuenta autenticada, y el cliente reenvía `q` y `status` junto a `nextCursor` para mantener el filtro en la página siguiente. Un estado fuera de lista responde 400 con los valores admitidos. La forma de la página y el orden por fecha no cambian.
- #358: recurso propio de sugerencias del agente por vista (ruta más vista o sheet, sin filtros ni entidad). `GET /intelligence/view-suggestions` devuelve hasta tres sugerencias activas del usuario con etiqueta, prompt de chat y acción propuesta opcional; si la caché venció, genera con el gateway de inferencia y guarda el resultado por usuario y vista durante 30 minutos. `DELETE /intelligence/view-suggestions/:id` descarta de forma persistente por usuario, vista y sugerencia; una etiqueta ya descartada no vuelve a crearse en esa vista y el descarte no afecta a otras vistas ni a otros usuarios. La acción propuesta sale solo de capacidades `WRITE` con confirmación AI-10 (`originType: AGENT_SUGGESTION`), nunca se aplica sola, y se cancela al descartar o vencer la sugerencia. Ritmo y cupo propios (20 por minuto y 100 por día en tablas nuevas) y solo comparte con el correo el tope global de 5 USD/día; sin modelo, ritmo o presupuesto la API devuelve la lista vacía sin error. Dos consultas simultáneas comparten la inserción idempotente de la clave única y releen las activas, y una generación fallida ajusta la reserva al costo conocido de las salidas rechazadas o la libera cuando no hubo consumo. Las sugerencias entran en la exportación de datos de IA, en el borrado total y en el vaciado selectivo por rama (`ai.viewSuggestions`).

- #356: las conversaciones del agente aceptan contexto de invocación con ruta, vista/sheet, filtros y entidad; el backend comprueba que la entidad sea accesible para el usuario, persiste el contexto y lo incorpora como dato no confiable al ensamblado. Se define `contextKey` como SHA-256 de JSON canónico para agrupar conversaciones en #357.
- #357: agrega `GET /intelligence/conversations/latest?context=<sha256>` y persiste/indexa la clave canónica por usuario. Sin coincidencia devuelve `conversation: null`; el historial global sigue disponible.
- #402: límites de clasificación del piloto. La cola clasifica como máximo 20 correos por minuto por usuario con un contador compartido en base (`ai_email_classification_minutes`), así que el límite vale entre réplicas y cuenta también las clasificaciones deterministas, la vista previa y `sample-import`; al conectar Gmail la conexión recibe 500 clasificaciones iniciales de una sola vez y después aplica el tope diario de 100. Antes de cada inferencia el costo global del día reserva de forma atómica su costo máximo y después lo ajusta al costo real de todos sus intentos, sin contar dos veces la completion rechazada; un modelo sin tarifa publicada usa un precio conservador por defecto. El tope diario de 5 USD registra alerta al 80 % y pausa la clasificación al 100 % hasta el reinicio UTC, conservando la cola. Cada inferencia guarda su costo estimado en `ai_inferences.cost_usd` con proveedor, modelo, tokens, duración y resultado. Solo los remitentes de bancos conocidos llegan al modelo y los correos largos se recortan antes de enviarlos. `GET /intelligence/email/usage` agrega uso y costo por día, hora, banco y tipo, con el restante de cada tope, para la vista de uso de web #426. Los avisos de tope se registran como notificación interna con cuántos correos quedan en cola. Un correo de remitente no bancario sin plantilla determinista queda `DISCARDED`, fuera de la cola de revisión.

- #382: al conectar Gmail se elige desde cuándo importar (`TODAY`, `LAST_MONTH` o `LAST_3_MONTHS`) y, opcionalmente, un `senderFilter` por dominio. La fecha se resuelve en UTC (meses de calendario con el día ajustado) y viaja en el `state` OAuth firmado; la conexión guarda `import_start_at` y `sender_filter`, y `GET /intelligence` los devuelve. El bootstrap y la recuperación consultan Gmail con `after:` y `from:`; el incremental no acepta consulta en el historial, así que descarta antes de guardar el correo anterior al corte o de otro remitente. La sync acotada de BHD también respeta el alcance. Sin período se conserva el bootstrap desde 2026-01-01, así que la web anterior sigue funcionando; reconectar con otro período no borra correo ya importado.

- #383: resuelve a mano un import de correo en `REVIEW_REQUIRED` con `POST /finance/imports/review/:id/resolve`: fija la fecha, elige la cuenta o tarjeta de destino, enlaza el reverso con su original o lo descarta con motivo. La decisión reaplica el mismo plan de importación con ese dato, valida el original con las reglas del reverso y solo escribe en el ledger si el plan la acepta; si sigue en revisión responde 422 con el motivo. Cada decisión queda auditada en `fin_signal_import_resolutions` (actor, fecha, acción, resultado y campos cambiados); el descarte deja el import en el estado terminal `DISMISSED` y repetir ese correo ya no lo reimporta. `GET /finance/imports/review` lista la cola con su motivo y candidato.
- #389: un pago de tarjeta registrado a mano que se parece a uno importado por correo —misma cuenta de origen, tarjeta, monto y moneda con fecha dentro de ±10 minutos, o la misma referencia bancaria— responde 409 `CARD_PAYMENT_POSSIBLE_DUPLICATE` con el candidato y solo se guarda con `duplicateAcknowledged: true`. La decisión y la escritura comparten transacción y el bloqueo por usuario de la importación, así que un correo simultáneo no duplica; sin candidato la ruta manual no cambia y solo compiten pagos importados.

- Sincronización Gmail acotada del piloto BHD (solo DEV): `POST /api/intelligence/email/sync-bhd` consulta `from:bhd.com.do` en una ventana y con un tope por página, importa solo los correos BHD que faltan y devuelve `found`, `imported`, `skipped` y `nextPageToken`. No cambia el cursor de la sync normal, no usa `/email/reset` y no existe en producción.
- #380: la clasificación BHD v6 importa los dos avisos de una misma transferencia como dos patas de la misma operación —misma cuenta, tipo opuesto, mismo monto y moneda, hasta 10 minutos, una pata con referencia de confirmación BHD y la otra sin referencia—, registra la pata de salida `TRANSFER_OUT` cuando el destino entre productos no está registrado y reintenta el reverso en `REVERSAL_COMMERCE_MISSING` cuando aparece su compra. Un fallo de inferencia queda `CLASSIFICATION_UNAVAILABLE`/`INFERENCE_PROVIDER_FAILURE`, distinto de `NO_TRANSACTION_CANDIDATE`. `sample-import` acepta hasta 50 correos en `dryRun` y mantiene 20 en la ejecución real. Se añaden fixtures saneados de los 20 correos del piloto.
- #374: aprobar una propuesta de producto acepta `{ productId }` para vincular un producto creado con los endpoints nativos —valida dueño, tipo, actividad e institución, guarda los últimos 4 finales y reevalúa las señales—; el listado y el descubrimiento marcan `matchedInstitutionId` y `matchedProductId` (con sus listas) para ofrecer «Vincular existente», y el descubrimiento ya no propone productos activos existentes: los cuenta en `alreadyExists` o `ambiguous`. Un producto archivado no cuenta como existente y ningún flujo duplica una institución compatible.
- #368: propone instituciones, cuentas y tarjetas detectadas en señales BHD de revisión con borradores editables, evidencia mínima y deduplicación; no crea productos hasta la aprobación explícita, y reevalúa las señales dependientes de forma idempotente. Las cuentas admiten últimos cuatro sin número completo. La transferencia recibida se lee con la etiqueta `Producto :`, y un pago de tarjeta propone la cuenta de origen, nunca la contraparte.
- #370: los formatos fijos de BHD se clasifican con reglas deterministas y no llaman al modelo: la alerta de tarjeta, la transferencia entre productos propios, la transferencia recibida y el aviso de estado de cuenta. El lector toma del texto la fecha, la moneda, el monto, la dirección, la clase, el comercio o la contraparte, la referencia y los últimos 4, con confianza fija `0.99` y método `DETERMINISTIC`, así que el resultado es el mismo con cualquier proveedor de IA y no consume presupuesto de modelo. La alerta exige su cabecera `BHD Notificación de Transacciones` y su sección `Detalle de Transacciones`: una tabla de otro correo no se lee como compra. La transferencia entre productos propios cruza los últimos 4 del destino con los productos activos del dueño, que pide a Finance por el puerto `EmailProductHints`: solo una tarjeta de crédito es `CARD_PAYMENT`; una cuenta o una tarjeta de débito es `TRANSFER_OUT`, y la variante a otros bancos también sale del origen sin inventar contraparte. Un destino no registrado en la variante entre productos deja la clase sin decidir para que el motor lo mande a revisión. En la muestra de auditoría de recall el modelo se sigue llamando pero solo mide: si el texto ya fijó la clasificación, esa manda. Un correo BHD fuera de esos formatos sigue usando la IA con rotación.
- #362: el preview `sample-import` devuelve proveedor y modelo por correo sin persistirlos, y enumera todos los motivos de revisión ordenados por gravedad.
- #354: los fallos de Groq y OpenRouter dejan una línea de log por intento con proveedor, modelo, estado HTTP, reintento, fallback y causa (`rate_limit`, `quota`, `auth`, `server`, `network` o `unknown`), y la telemetría del fallo final conserva `cause`, `status` y `retryable` en `errorCode`. El mensaje del SDK se sanea y se trunca; no se registran claves, cabecera `Authorization` ni cuerpos del proveedor.
- #334: empareja las dos patas de una transferencia importada por correo después de escribirla, con un candidato único y las reglas existentes (tipo opuesto, institución distinta, moneda, monto con tolerancia de comisión). Con la misma referencia bancaria la ventana sube de tres a siete días; sin referencia se conservan tres. Con varios candidatos no se elige ninguno y `TRANSFER_PAIR_AMBIGUOUS` queda en la evidencia de la pata.
- #335: registra un pago de tarjeta confirmado por correo como la misma operación de dos patas de la ruta manual: dos filas `CARD_PAYMENT`, la cuenta baja y el disponible de la tarjeta sube, sin gasto ni presupuesto. Solo la pata de origen lleva `importReference`. La conciliación compara siete días cuando la referencia está presente y tres días sin referencia; un pago manual parecido se vincula y la duda va a revisión. Un aviso pendiente o un recordatorio no crean movimiento.
- #342: agrega la selección acotada de correos del piloto: una vista previa que reclasifica hasta 20 correos con el modelo sin escribir nada y devuelve el manifiesto con el movimiento que crearía (o las dos entidades de un pago de tarjeta), y una ejecución idempotente que procesa solo esos ids, sin ampliar por remitente ni por plantilla. La predicción y la escritura comparten el mismo paso de decisión de Finance. La ruta responde 404 en producción.
- #337: la fecha de encabezado se conserva como sugerencia `EMAIL_HEADER` y mantiene el correo en revisión hasta confirmar una fecha de operación; los motivos de ambigüedad ya no incorporan el conteo y guardan candidatos en evidencia.
- El contrato de importación por correo documenta transferencias de una pata, pagos de tarjeta, fechas sugeridas y reversos por la cadena del ADR-003 (#334–#337).
- #308: reorganiza `docs/refactors` por programa y fase; añade índices con objetivos, issues, PRs y estados, y conserva inventarios y borradores anteriores en `archive/`.
- Catálogos CSV con 104 casos manuales AI-0 a AI-11 y una herramienta para generar rondas XLSX y exportar sus resultados a CSV (#309).
- NOTIF-0 (#245): adopta el consumidor neutral de `NotificationIntent` en Notifications y valida intents por versión y forma sin conectar todavía productores ni delivery.
- PLATFORM-SETTINGS-0 (#244): define el descriptor y registro genéricos de module settings y compone Finance, Agenda, Projects y Health sin cambiar el formato persistido ni la API vigente.
- PLATFORM-EVENTS-0 (#243): retira los nombres y DTOs de dominio Finance del catálogo de Core; listeners e integración consumen `FinanceEvents` sin cambiar nombres ni entrega.
- FIN-0 (#242): define contratos propios de Finance para eventos versionados, adaptadores de IA/contexto, señales e intents; las publicaciones usan sus nombres sin depender de constantes de Core. La CI admite ejecución manual para validar una rama antes de abrir PR.
- AI-11 (#214): importa señales financieras idempotentemente por señal, conserva procedencia y datos monetarios originales, y envía candidatos ambiguos a revisión sin dar acceso de Gmail a Finanzas.
- #312: al verificar un correo o un lote se reclasifican con la etiqueta verificada los demás correos ya clasificados de la misma plantilla (remitente y huella), sin generalizar a otras plantillas ni a huellas nulas; se conservan las verificaciones humanas, se excluye HOLDOUT, no se llama al modelo y cada correo mantiene una sola señal `FINANCE.*`. Repetir la misma verificación no agrega evidencia y reintenta la reclasificación tras un fallo; el run del pase fallido queda `FAILED`, no en `RUNNING`. La respuesta informa `requeued`. Promover conocimiento GLOBAL lo aplica al historial propio y revertirlo reencola los correos que lo usaron. Los correos que quedan `PROCESSED` salen de la cola pendiente y de sus conteos sin marcarse como verificados; el filtro `PENDING` excluye `PROCESSED` sin ocultar el historial verificado en filtros combinados.
- AI-10 (#213): aplica política `AUTO_ALLOWED` / `CONFIRM_REQUIRED` / `FORBIDDEN` a capacidades mutantes, con acciones auditables, confirmación, cancelación y claims atómicos.
- AI-9 (#212): añade conversaciones privadas, historial y resúmenes por usuario; el runtime ejecuta herramientas de solo lectura y Finance registra un resumen mensual consultado con datos reales.

- AI-8 (#211): agrega contrato neutral, registro y ejecutor de capacidades con validación de entrada/salida, contexto delegado y composición de proveedores desde `apps/api`.

- AI-7 (#210): publica señales financieras de correo con evidencia, deduplicación por mensaje y entrega durable a BullMQ; una señal agrupa el candidato de cada correo.

- AI-6 (#209): filtra la revisión por incertidumbre y evalúa métricas de transacciones sobre una membresía HOLDOUT congelada; compara runs compatibles con deltas, y cada reejecución crea un run sin escribir observaciones ni alterar Knowledge.

- AI-5 (#208): clasifica correos con conocimiento USER/GLOBAL, parser determinista y respaldo de inferencia validada; registra observaciones por ruta, envía resultados inciertos a revisión y muestra método, conocimiento y proveedor/modelo en el detalle. La ruta no crea movimientos financieros.

- Los grupos de revisión devuelven el id de cada correo de muestra en `sampleMessageIds`, en el mismo orden que `sampleSubjects`, para abrir su detalle desde la vista de grupos (#279).
- #219: la cola de revisión busca por asunto y remitente, filtra por rango de días y estado (`PENDING`, `CONFIRMED`, `CORRECTED`, `REJECTED`), ordena por fecha en ambos sentidos y devuelve la última verificación de cada correo con sus etiquetas, nota y fecha; los filtros se combinan con la partición y el cursor, y un filtro inválido responde 400.
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

### Corregido

- #508: `sendExpoTokens` vuelve a tratar una respuesta 2xx de Expo sin `data` como una tanda sin tickets (cero enviados, cero fallos) en vez de lanzar al leer `length`. Al extraer `readExpoTickets` en #505 se perdió el `?? []` que cubría ese caso. La prueba nueva falla sin el resguardo y pasa con él.
- #466: las rutas del agente declaran su propio `@Timeout` de 30 s. `POST /api/intelligence/conversations`, `POST /api/intelligence/conversations/:id/messages` y `GET /api/intelligence/view-suggestions` dejan de caer en el límite global de 5 s, que cortaba un turno con varias rondas de herramientas mientras el trabajo seguía en segundo plano. Al agotarse el tope, el JSON responde 408 `Request timed out after 30000ms` y el flujo SSE se corta sin `done`; el mensaje del usuario queda guardado, así que repetir su `clientMessageId` devuelve la respuesta si terminó o retoma el turno. Sin cambio en la forma de la respuesta.
- #488: el filtro de errores usa el tipo `TimedRequest` de `request-log.ts` en vez de repetir el campo `startedAt` en su tipo inline, y su prueba recibe un objeto de opciones en lugar de tres parámetros. Sin cambio de comportamiento; el log del fallo sigue llevando `durationMs` cuando el interceptor arrancó la petición.
- #468: `GET /health/ready` deja de consultar JWKS y solo comprueba la base y Redis: una ruta pública anónima ya no depende de un tercero en cada sonda ni acumula conexiones cuando el proveedor no responde. `GET /health/startup` conserva el ping a JWKS con timeout de 2 s y reutiliza un resultado correcto durante 60 s; un fallo no se cachea, así que la siguiente sonda reintenta. El cuerpo sanitizado y el 503 no cambian.
- #473: tres documentos apuntan a rutas y límites que ya no existen. `inference.md` vacía la telemetría con `POST /api/users/me/data/wipe` y la rama `ai.inferences` de `GET /api/users/me/data/branches`, no con un `DELETE` que no existe. `errors-and-envelope.md` explica la retención de la `Idempotency-Key` al agotarse el timeout con `POST /api/intelligence/email/sample-import`, que guarda y encola el trabajo antes de responder `202`. `security.md` documenta los límites reales del chat —throttle global y el tope por defecto de 5 s— y remite al issue #466 para el `@Timeout` propio de las rutas del agente. Solo documentación.
- #472: el contrato publicado describe lo que el endpoint acepta. `swagger-spec.json` publica `maxItems: 20` en `quotes` de `GET /api/finance/exchange-rates` y el mismo `type: integer` para `limit` en `/api/intelligence/messages` y `/api/intelligence/conversations`, que el DTO de mensajes publicaba como `number`. Cambio aditivo: el cliente puede validar el tope de monedas y el tipo del límite antes de llamar. Sin migración.
- #471: la línea de una petición fallida lleva su estado HTTP real y aparece una sola vez. `LoggingInterceptor` ya no registra el fallo con el `200` que la respuesta todavía tenía: lo registra `AllExceptionsFilter`, que también ve los rechazos de un guard o middleware. El nivel sigue al estado —4xx como `warn`, sin stack; 5xx como `error`, con stack y evento en Sentry— así que un cursor vencido o una validación no cuentan como fallo del servidor. Cuando el interceptor arrancó la petición, la línea del fallo conserva su `durationMs`. Sin cambio de contrato HTTP.
- #469: la tabla de entorno y las notas de desarrollo nombran las variables de Gmail que el schema valida (`AI_GMAIL_CLIENT_ID`, `AI_GMAIL_CLIENT_SECRET`, `AI_GMAIL_REDIRECT_URI`) y la ruta vigente del callback, `GET /api/intelligence/email/oauth/callback`; antes pedían `GOOGLE_*` y una ruta retirada. Se retira el nombre viejo de `ci.yml`, de `test/helpers/test-env.ts` y del entorno base de `env.schema.spec.ts`. Sin cambio de código de producto.
- #467: `AllExceptionsFilter` comprueba `headersSent` antes de responder. Cuando la respuesta ya empezó —SSE del chat, exportación de datos o cualquier `@Res()`— registra el fallo y destruye el socket en lugar de intentar fijar estado y cuerpo, así que no aparece `ERR_HTTP_HEADERS_SENT` dentro del manejador de excepciones. Sin cambios en las respuestas que aún no enviaron cabeceras.
- #474: el tope diario de tokens de Uso cuenta todos los tokens del día UTC, también los de la carga inicial de 500, y muestra el mismo total que la fila del día en la tabla. Antes la carga inicial eximía del tope y el contador quedaba en 0, así que no se podía saber si el piloto estaba dentro del límite. La carga inicial sigue limitando cuántas clasificaciones de bienvenida quedan, y si el tope diario se agota primero la clasificación espera al reinicio de las 00:00 UTC. El costo global se publica con `scope: ALL_USERS` para dejar claro que es el costo del piloto completo, no de una cuenta.
- #446: dos movimientos simultáneos en una moneda nueva de la misma tarjeta comparten una sola fila de saldo. El ledger crea el saldo con `upsert` sobre la clave única `(cardId, currency)` y suma el delta, en vez de buscar y crear, que perdía el segundo movimiento con `P2002`.
- #446: el readiness de Redis reutiliza una conexión entre sondas, la descarta si se cae y la cierra con `quit` al apagar el módulo; antes abría un cliente por sonda y lo desconectaba sin esperar. Cada conexión y cada ping tienen tope de 2 s y no reintentan solos.
- #445: `GET /finance/exchange-rates` acepta hasta 20 monedas y cotiza una vez cada par; el balance reutiliza las tasas por par y fecha dentro de la petición. Ambos endpoints tienen timeout propio de 15 s. Un exceso de monedas responde 400. Sin migración.
- #444: la exportación de datos de IA se escribe por partes con el mismo envelope JSON; pagina cada colección de 200 filas y respeta la contrapresión de la respuesta, así que no carga todo el correo en memoria. El contrato no cambia.
- #443: `OAUTH_STATE_SECRET` firma el state de Gmail y queda separada de `AI_GMAIL_TOKEN_ENCRYPTION_KEY`; el schema la exige en producción y con Gmail configurado, y rechaza reutilizar la clave de tokens. Se retira `ENCRYPTION_KEY`, que el código no usaba.
- #442: pruebas de comportamiento del verificador JWT de producción (firma RS256, vencimiento, emisor, audiencia, algoritmo, `kid` y `sub`) y del handshake del WebSocket (sin token, token inválido y room por usuario).
- #438: el `wake` del outbox y su cron registran un fallo de base y resuelven, en vez de dejar una promesa rechazada que podía terminar el proceso. El cron de 30 s sigue siendo el reintento; los productores pueden seguir llamando `wake` con `void`.
- #453: la prueba de caída del outbox espera hasta 30 s a que arranque el worker hijo, en vez de 10 s. El plazo solo aplica al arranque de la prueba; un worker que de verdad no llega sigue fallando.
- #440: el borrado de Auth usa un lease de 5 minutos con `claimed_at`. Un proceso que cae después de reclamar deja la fila recuperable y el siguiente ciclo la reintenta; una fila sin `claimed_at` de un despliegue anterior también se recupera. El cierre exige el mismo intento y solo el worker que aún tiene el lease puede marcarla `COMPLETED`, `FAILED` o `DEAD`.
- #439: cambiar la moneda base memoriza cada par moneda/fecha dentro de la petición, limita la concurrencia a lotes de 25 y amplía a 30 s el timeout de la petición y de la transacción. Antes de escribir, la transacción vuelve a leer la moneda configurada; si otra petición la cambió, responde 409 y no escribe nada.
- #441: los logs dejan de incluir la URL cruda y los objetos `req`/`res` de pino-http. El interceptor y el filtro registran la plantilla de ruta (`/api/public/receivable-shares/:token`), así que el token del enlace público, el código y el state del callback OAuth y los tokens push no quedan en logs ni en Sentry.
- #437: confirmar, desconfirmar, borrar y reversar un movimiento reclaman la fila con una actualización condicionada al estado leído antes de tocar saldo o presupuesto. Si otra petición ya cambió el movimiento, la segunda devuelve el estado vigente sin volver a aplicarlo; el borrado marca la fila como `CANCELLED` dentro de la misma transacción antes de revertir y eliminar. Una prueba de integración confirma que dos confirmaciones simultáneas dejan un solo incremento de saldo.
- #436: el listado de correos de Inteligencia vuelve a aceptar el tamaño de página que envía la web. `GET /intelligence/messages` admite `limit` entre 1 y 100, con 50 por defecto, y lo combina con `q`, `status` y el cursor; fuera de rango responde 400 nombrando el parámetro. La búsqueda, el filtro por estado y la forma de la página no cambian. Sin migración.
- #431: la documentación de clasificación aclara que los avisos de depósito de nómina de Popular no traen monto ni moneda en el texto, tampoco en el HTML crudo. En los 20 avisos revisados no hay ninguna cifra con forma de monto, así que la clasificación deja la transacción sin `amount` y el import queda en revisión con `AMOUNT_MISSING`; el valor no se estima ni se completa desde otro correo. Los ejemplos saneados del repo ya lo registran con `expected.amount: null`.
- #430: la clasificación ancla la moneda al texto del correo para cualquier remitente con transacción. `RD$`, `DOP` o `RD` cerca del monto dejan `DOP`; `US$`, `USD` o `US` dejan `USD`. Si el texto contradice al modelo, gana el texto y `currencyEvidence` conserva la diferencia; sin marcador, la transacción queda sin moneda y la importación va a revisión. El anclaje BHD de fecha y reversos no cambia.
- #433: la clasificación del modelo ancla `accountNumberLast4` al texto del correo cuando trae una cuenta enmascarada (`****1234`, `******_0024`, `*2581`). La máscara única gana sobre el modelo; se descartan las de beneficiario/ordenante, tarjeta, cédula, teléfono, referencia y confirmación; si hay más de una cuenta distinta o no hay máscara, se conserva el valor del modelo. Solo aplica a clasificaciones `MODEL`, después del anclaje BHD; las deterministas y las de conocimiento no cambian. Sin migración ni cambio de contrato.
- #423: `GET /intelligence/email/usage` distingue la carga inicial sin Gmail conectado de la agotada. `caps.initial` gana `connected`: en `false` no hay conexión y la web puede ocultar o explicar la fila; en `true` con `remaining: 0` la carga está agotada de verdad. `limit` y `remaining` se mantienen, así que la vista actual sigue funcionando sin cambios de tipo. Sin migración.
- #419: el contrato OpenAPI versionado se regenera desde el código de `develop` y vuelve a coincidir con el documento que la API escribe al arrancar fuera de producción: 183 rutas y 296 schemas, con los endpoints de sugerencias, el filtro `q`/`status` de la lista de correos y el resumen de uso. El estado del correo en el contrato incluye `CLASSIFYING` en el resumen y en el detalle, que ya guardaba el enum de la base y el detalle devolvía; el filtro de la lista conserva sus cinco estados.
- #384: el piloto de clasificación deja llegar al modelo los remitentes reales de Popular y Qik. `AI_EMAIL_BANK_SENDER_DOMAINS` suma `popularenlinea.com` y `qik.com.do` a sus valores por defecto, así que `popularenlinea.com`, `alertas.popularenlinea.com` y `mail.qik.com.do` dejan de descartarse antes del modelo y pasan por la clasificación con las reglas del piloto. `encuestas.popularenlinea.com` entra por ser subdominio de Popular y queda descartado por irrelevancia, como el resto de la publicidad. Sin cambio de contrato.
- #406: el CI corre en los runners self-hosted con `pull_request`; los PRs usan el workflow del merge y el push a `develop` o `master` el de la rama.
- #399: la propuesta de cuenta detectada en un correo BHD toma los cuatro dígitos finales del token completo —un IBAN enmascarado como `DO26BCBH000000000XXXXXXX0016` propone `0016`, no `0000`—, confirma ese número contra `accountNumberLast4` de la señal y no crea propuesta ni evidencia cuando no coincide; la evidencia guarda la etiqueta y el lado que aportaron el número. Las propuestas ya existentes no cambian.
- #396: la prueba de borrado de datos de IA revisa solo los campos que pueden filtrar datos personales del update —`notes`, `correctedPayload`, `structuralKeys` y `structuralPayload`— en vez de buscar subcadenas en todo el objeto. El UUID aleatorio del tombstone ya no puede contener el monto ni los cuatro últimos dígitos y hacer fallar la prueba sin que haya una fuga. Sin cambio de comportamiento.
- #379: cuando exchangerate.host rechaza la petición (401/403), no responde (red o 5xx), agota la cuota o falta la clave, el error real viaja como `PROVIDER_UNAUTHORIZED`, `PROVIDER_UNAVAILABLE`, `API_KEY_MISSING` o `PROVIDER_ERROR` en vez de un «No exact-date rate»; el ledger responde 503 en esos casos y 400 solo si de verdad no hay tasa. Para fines de semana y feriados busca la última publicación hacia atrás en la caché y, si falta, en el proveedor —sin quedarse con una caché más antigua que una publicación posterior—, registra la fecha aplicada en `aiMetadata` (`exchangeRateDate`, `baseExchangeRateDate`) y también en pagos de tarjeta y retiros ATM (`destinationExchangeRateDate`, `destinationBaseExchangeRateDate`). La contraparte ATM completada desde un gasto también conserva la fecha y la tasa aplicadas. La cotización de hoy sigue siendo exacta.
- #376: al volver a calcular el plan de importación —al aprobar una propuesta o repetir `sample-import`— un import previo en `REVIEW_REQUIRED` por falta de cuenta o tarjeta (`NO_LEDGER_TARGET`, `AMBIGUOUS_LEDGER_TARGET`, `TRANSFER_ACCOUNT_NOT_FOUND`, `TRANSFER_ACCOUNT_AMBIGUOUS`, `CARD_PAYMENT_CARD_NOT_FOUND`, `CARD_PAYMENT_CARD_AMBIGUOUS`, `CARD_PAYMENT_SOURCE_ACCOUNT_NOT_FOUND` o `CARD_PAYMENT_SOURCE_ACCOUNT_AMBIGUOUS`) se vuelve a resolver contra el libro actual en vez de devolver el resultado guardado. Si la cuenta o la tarjeta ya existe, el movimiento se importa una sola vez; si sigue ausente, el import permanece en revisión, y un import aplicado o en revisión por otro motivo no cambia.
- #369: un reverso sin comercio se enlaza con una única compra de la misma tarjeta y cuenta, con el mismo monto y moneda, hasta tres días antes del aviso. La tarjeta se resuelve por su `last4` a su cuenta; una compra con tarjeta sin `accountId` cuenta como la cuenta de esa tarjeta. La evidencia guarda el paso `CARD_ACCOUNT` y la ventana de 3 días. Cero compras, varias, o una tarjeta ausente o ambigua dejan el reverso en revisión; el reverso parcial mantiene su regla.
- #366: la clasificación de correos BHD lee del propio correo la clase y el lado del movimiento cuando la plantilla los declara. Una alerta de tarjeta con `Tipo: Compra`, cuyo monto coincide con el del movimiento, queda como `PURCHASE` con dirección `DEBIT`: una compra en un comercio nunca se guarda como pago de tarjeta, y si el modelo no devuelve dirección el texto la aporta. Un correo de transferencia con `Producto origen` y `Producto destino` fija el lado en `TRANSFER_OUT`, porque el dinero sale del origen, y conserva la clase del modelo para que el pago de tarjeta del mismo formato siga siendo `CARD_PAYMENT`. La fila de la alerta no se usa si su monto no coincide con el del movimiento. En el preview v4 corrige #13 (compra con tarjeta leída como pago de tarjeta), #4 (dirección perdida) y #16 (transferencia leída como entrada).
- #363: la clasificación de correos BHD usa la fecha día/mes/año y la hora local de America/Santo_Domingo (UTC-4) del texto, confirma la moneda `RD$`/`DOP` frente a `US$`/`USD` y fuerza los reversos a `REFUND` en lugar de compra. Si la fecha o la moneda no se pueden verificar, no se guardan y el movimiento queda en revisión. La evidencia de una moneda corregida queda en `currencyEvidence`.
- #360: OpenRouter no registraba uso porque la petición no limitaba los tokens de salida: reservaba el máximo del modelo (131072) y la cuenta respondía 402 antes de inferir. Las llamadas ahora piden 4096 tokens y el respaldo responde.
- #351: la clasificación de correo deja de perder etiquetas válidas por una salida del modelo que rompía reglas cerradas que el esquema permitía y el prompt no explicaba. Un tipo sin transacción que llega con un `transaction` que solo declara `kind: NOT_TRANSACTION`, o con un intento `DECLINED`, `REJECTED`, `FAILED`, `CANCELLED` o `VOIDED`, se acepta sin ese objeto; un monto con estado aprobado no se normaliza y sigue el camino de rechazo y revisión. Un `SECURITY_OTP` con `relevance: true` se marca como no financiero. El esquema que recibe el modelo ya no ofrece `NOT_TRANSACTION`, y el prompt pide omitir `transaction` cuando no hay movimiento. Un fallo de validación admite un único reintento de reparación con la causa del rechazo; si también falla, el correo queda sin clasificar y en revisión, sin inventar datos. El error y la telemetría distinguen `INVALID_JSON` del campo rechazado. En el preview del piloto BHD los cinco correos que quedaban sin etiqueta se clasificaron.

- #342: `POST /api/intelligence/email/sample-import` amplía a 480 segundos su timeout propio para procesar hasta 20 correos en serie; el interceptor global conserva sus 5 segundos por defecto.
- Seguimiento de #347: el cursor de `IMPACT` guarda el primer correo de la página siguiente y lo busca por id en la lista actual, así que verificar el último correo de una página no invalida la paginación. `UsersService` exige el registro de settings de módulo y ya no guarda configuración sin validar cuando falta. El contrato de revisión corrige `uncertain`: umbral personal fuera de HOLDOUT y `0.7` fijo en HOLDOUT.

### Cambiado

- #524: el conjunto de `NODE_ENV` se declara una vez (`NODE_ENVIRONMENTS` en `env-helpers.ts`): el campo del schema y el tipo que usan las reglas salen de ahí. `defaultedStrictBoolean` declara el tipo que devuelve. Sin cambio de comportamiento.
- #522: el consumidor de señales de Finance, de 2255 líneas, se parte por responsabilidad: el esquema del payload, los tipos y fábricas del plan, el estado del import, el destino en el ledger, los planes de movimiento, de reverso y de pago de tarjeta, el reintento de reversos, el emparejamiento de transferencias y la vista previa con sus motivos. `FinanceSignalConsumer` queda como coordinador, con las mismas siete dependencias y los mismos métodos públicos; estados, motivos de revisión, destinos, evidencias y metadatos no cambian. Los colaboradores nuevos reciben un objeto con sus dependencias y `financeValidationReviewReasons` baja su complejidad. Quedan pendientes el aviso del constructor de siete dependencias y `import-review-resolution.service.ts`, que van en un PR aparte.
- #515: limpieza de `packages/config` contra `CODING_GUIDELINES.md` sin cambio de comportamiento. Las nueve reglas entre campos del entorno salen del `superRefine` a `env-refinements.ts`, cada una con los valores que comprueba, y el schema queda como campos más orquestación; los helpers de campo y los dominios bancarios por defecto pasan a `env-helpers.ts`, y el campo booleano estricto se arma con una sola función que usan `DATABASE_SSL_REJECT_UNAUTHORIZED` y `EMAIL_DELIVERY_ENABLED`; `parseStrictEnvBoolean` reparte las ramas de número y texto en funciones propias. Mismos mensajes, mismos `path` de Zod y mismo orden. `envSchema` y `Env` siguen en `env.schema.ts`.
- #493: `CatalogRepository`, de 1070 líneas, se parte por agregado en repositorios de cuentas, instituciones, tarjetas, saldos de tarjeta, categorías, efectivo e historial de instrumentos, y un módulo común para los borrados. Cada servicio inyecta solo el repositorio de su agregado; las consultas, sus filtros y sus resultados no cambian. `upsertCardBalance`, `setCardCreditLimit` y `updateCategory` reciben un objeto en vez de parámetros sueltos. Los constructores con más de tres dependencias siguen pendientes de decisión.
- #511: auditoría de `packages/database` sin cambio de comportamiento. `createScriptPrismaClient` declara el tipo de retorno generado por Prisma y el fallback del parseo de URL explica que `pg` acepta formatos que `URL` no, con una prueba del par `connectionString`/`ssl` que ya devolvía. El resto del código propio no tiene casts, `any` ni desactivaciones de ESLint.
- #510: el paquete `logos` deja de usar casts sin razón en el dominio de redes y en el cliente de Logo.dev. La red se resuelve con una guarda que no lee claves heredadas y la búsqueda anota el payload como `unknown` y lee cada fila con una guarda; una fila vacía conserva el fallo que ya terminaba en el `catch` con aviso. Pruebas nuevas cubren la guarda de redes y las filas malformadas. Sin cambio de comportamiento.
- #513: el paquete `contracts` reparte su índice por tema —primitivas JSON, settings de módulo, eventos de dominio, notificaciones, conversación del agente, inferencia estructurada, capacidades de IA, señales enrutadas y propuestas de correo— y deja `index.ts` como barrel con los mismos exports. Ningún consumidor cambia su import: la superficie pública, los tokens y los valores siguen igual, y `StructuredInferenceOutputError` y `StructuredInferenceProviderError` conservan su forma, su mensaje y su `code`. Sin cambio de comportamiento.
- #498: `AiCapabilityRegistry` valida cada definición en un módulo propio con guardas tipadas sobre `unknown`, en vez de una lista que se ensanchaba a `any[]`, y separa la autorización de escritura de la ejecución. Sin cambio de comportamiento: mismos errores, mismos descriptores y mismas reglas; la suite del registro no cambia.
- #505: limpieza de `packages/notifications` contra `CODING_GUIDELINES.md` sin cambio de comportamiento. `validateNotificationIntent` comprueba cada campo en su propia función de aserción, en el mismo orden y con los mismos mensajes, y deja una sola razón escrita para los casts que quedan; `EmailSyncProcessor.process` resuelve el destinatario en `resolveRecipient` y registra campos en vez de concatenar, con el correo enmascarado (`***@dominio`), así que el correo completo ya no llega al log; `PushSenderService.sendExpoTokens` delega el recuento de tickets en `readExpoTickets`, y el helper del spec de OpenAPI recorre los estados y resuelve el `$ref` por separado. Los constructores de `NotificationsService` y `NotificationIntentPipeline` siguen igual: bajarlos pide partir la clase y es una decisión de diseño.
- #502: el comentario de `loadModuleForConfigUpdate` en `packages/users` describe lo que hace el método —comprueba el patch, consulta las filas que necesita y no escribe— en vez de afirmar que valida antes de tocar la base. Solo comentario.
- #500: limpieza de `packages/users` contra `CODING_GUIDELINES.md` sin cambio de comportamiento. `parseUserPreferences` lee cada valor con `readBoolean`/`readString` y resuelve `defaultProvider` y la zona de quiet hours sin ternarios anidados; `updateModuleConfig` separa la validación (`loadModuleForConfigUpdate`) del anuncio de eventos (`emitModuleConfigEvents`) y deja de repetir una condición que el guard anterior ya cubría; `upsertUserModule` y `failAuthDeletion` reciben un objeto con su tipo en el puerto, y el helper del spec de OpenAPI recorre los estados en un bucle. Pruebas nuevas fijan la lectura de valores guardados inválidos, el `null` de `defaultProvider` y la precedencia de la zona de quiet hours. Los constructores de 4 dependencias quedan como estaban: bajarlos pide partir la clase y es una decisión de diseño.
- #496: limpieza de `packages/auth` contra `CODING_GUIDELINES.md` sin cambio de comportamiento. Los algoritmos aceptados (`RS256`, `ES256`) viven en `domain/jwt-algorithms.ts` y los usan la estrategia y el verificador; las opciones del cliente JWKS (caché, ritmo de 10 por minuto y URI) salen de `infrastructure/jwks-client-options.ts` para que los dos caminos no se separen; `createJwksSecretProvider` y `createPassportJwksSecret` declaran su tipo de retorno, el `require('jwks-rsa')` explica su cast, el log de un borrado fallido lleva el usuario y el mensaje del proveedor como campos, y `session()` declara su tipo de retorno. Pruebas nuevas fijan la lista de algoritmos (sin HS256) y las opciones del JWKS en los dos consumidores.
- #492: el catálogo parte `CatalogService` en servicios por responsabilidad —cuentas, instituciones, tarjetas, saldos de tarjeta y propuesta de producto por correo— y conserva `CatalogService` como fachada con la misma superficie para controladores y consumidores. Sin cambio de comportamiento, de validaciones ni de contrato HTTP: las aserciones de las pruebas del módulo no cambian. Los constructores con más de tres dependencias y la partición de `CatalogRepository` siguen en #493.
- #491: limpieza de `packages/core` contra `CODING_GUIDELINES.md` sin cambio de comportamiento. El mensaje interno del filtro sale de `serverErrorMessage` en vez de un ternario anidado; los códigos Prisma `P2002` y `P2025` se nombran una vez en `exceptions/prisma-error-code.ts` y los usan el filtro y el interceptor de idempotencia; cada `as` que queda lleva su razón escrita y lo que no la necesitaba (`handleRequest` del guard JWT, `JSON.parse` del cuerpo guardado) deja de castear. El middleware de Bull Board pierde un `try/catch` que no podía ejecutarse (`Buffer.from` con base64 no lanza) y nombra el prefijo `Basic`; `toCursorPage` declara su entrada `readonly` y no devuelve la misma lista; el decorador `RequiresEnabledModule` declara su tipo de retorno. Se cubre el mensaje del filtro con pruebas de producción, desarrollo y rechazo sin `Error`, y se cubren los códigos Prisma, el guard JWT y el 401 de Bull Board.
- #465: `multer` sube a 2.5.0, `follow-redirects` a 1.16.3 y `effect` a 3.22.5 con overrides de pnpm en `pnpm-workspace.yaml`, y el audit de dependencias de producción del CI deja de ser opcional: `pnpm audit --prod --audit-level=high` bloquea el job, así que una vulnerabilidad alta nueva no entra en verde. `pnpm audit --prod` queda sin altas (3 bajas y 5 moderadas, fuera de alcance).
- #452: el controlador de la lista de conversaciones usa el `limit` que ya valida y completa el DTO de query, sin volver a recortarlo. Sin cambios de comportamiento, respuestas HTTP ni contrato.
- #452: `GET /intelligence/conversations` pagina por cursor con `limit` de 1 a 100 (20 por defecto) y devuelve `{ items, nextCursor, hasMore }` en lugar del array completo, un cambio incompatible que la web adopta en personal-os-web#478. Mantiene el orden por última actualización descendente con desempate por id; el cursor codifica esa posición, así que una conversación nueva entre dos lecturas no repite ni salta filas de la tanda siguiente. La última página responde `hasMore: false` y `nextCursor: null`, y un cursor mal formado responde 400.
- #446: la subida de logo de institución, comercio y suscripción responde `400` cuando el formato no es PNG, JPG o WEBP o pasa de 1 MB, y `503` cuando el storage no está configurado. Catálogo y Comercios dejan de convertir cualquier fallo en `400`, y el caso queda documentado en `docs/modules/logos/overview.md`.
- #446: el AES-256-GCM de números de cuenta y de tokens de Gmail vive en `@personal-os/core` (`encryptSecret`, `decryptSecret`, `deriveSecretKey`), con el mismo formato `iv | tag | ciphertext` y la misma derivación `sha256(secreto)`, así que el cifrado ya guardado se sigue leyendo. Se retira `DomainException`, que no se exportaba ni se usaba. Los documentos de infraestructura listan los interceptores reales de `CoreModule`, los 14 crons registrados y el state OAuth como base64url con HMAC.
- #459: el flujo de trabajo versiona `scripts/project3.ps1` y la regla «Project 3 siempre al día»; los issues nuevos entran al tablero al crearse y `check` exige `Cancelado` para los cerrados como `not planned`, con el id de esa opción resuelto por nombre.
- #402: el tope diario por usuario deja de ser 100 clasificaciones y pasa a medirse en tokens (`AI_EMAIL_DAILY_TOKEN_BUDGET`, 320 000 por defecto, unos 120 correos): cada llamada reserva su consumo estimado y lo ajusta a los tokens reales, y el aviso de tope agotado lo informa así. La carga inicial de 500 clasificaciones por conexión sigue igual porque es una promesa de bienvenida; el respaldo de costo global de 5 USD por día no cambia. El endpoint `GET /intelligence/email/usage` devuelve `daily.limitTokens` y `daily.usedTokens` en lugar de `limit` y `used`.
- #390: `pnpm test` incluye una suite de arquitectura con un test dedicado por cada una de las ocho invariantes de frontera del roadmap: runtime de IA frente a Finance, Gmail fuera de Finance, contexto de chat fuera de Finance, Notifications sin semántica de Finance, Core sin eventos de Finance, Users sin validadores de Finance, registro de un módulo nuevo sin defaults centrales y eventos de dominio fuera de las constantes de Core. Sin cambios de comportamiento.
- #321: la policy de Notifications y el guard de módulo habilitado consultan el lector genérico de settings (`MODULE_SETTINGS_READER`) en vez de leer defaults o el registro directamente. El lector expone `hasDescriptor(slug)`; la policy conserva los motivos de bloqueo de módulo deshabilitado y de preferencia apagada, y el guard responde 403 igual que antes, incluido un slug sin descriptor. Sin cambios de formato guardado, respuestas HTTP ni textos.
- #324: la policy de Notifications resuelve la preferencia del módulo con el `sourceDomain` y el `preferenceKey` del intent a través de `MODULE_SETTINGS_READER`; deja de derivar el módulo de `data.moduleSlug`, que se conserva como respaldo para las altas directas. Un módulo nuevo registra su descriptor y evalúa su preferencia sin cambios en Users ni Notifications. Sin cambios de copy, canales ni horas de silencio.
- #323: Finance produce sus avisos con `FinanceNotificationsListener` y los entrega como intents al pipeline; Notifications deja de escuchar eventos financieros y pierde la dependencia de `@personal-os/finance`. `NotificationIntentModule` expone el sink para que los productores usen el token de contracts, y una prueba de arquitectura impide que Finance y Notifications se importen. Durante la transición, el listener consulta los recibos del listener anterior para no duplicar un evento reentregado. Textos, preferencias, deduplicación y canales no cambian.
- #322: Notifications procesa los `NotificationIntent` con un pipeline genérico: la policy filtra cada canal solicitado (preferencia del módulo y horas de silencio), cada fila se escribe con su recibo de canal y su puntero en una misma transacción, y la entrega ocurre después del commit (WebSocket para IN_APP, cola `notifications` para PUSH y EMAIL con `jobId` igual al id de la fila). Un intent repetido no crea filas de nuevo; si el encolado falló, el reintento reentrega la fila persistida porque el recibo de entrega aún no existe, y un canal ya entregado se salta. No cambian endpoints, canales ni el listener de eventos de Finance.
- #318: Finance es dueño del copy, la clave de preferencia y la deduplicación de sus avisos. `FinanceNotificationIntents` traduce cada evento financiero a un `NotificationIntent` neutral (`sourceDomain: finance`, canales `IN_APP`, `data` compatible y clave estable por hecho; las dos patas de una transferencia comparten el aviso). Borrados, rechazos, cancelaciones, reversos y movimientos ya anunciados no generan intent. La entrega sigue igual: Notifications interpreta los eventos hasta NOTIF-2 y ahora toma el copy de `@personal-os/finance`.
- #320: los defaults, las claves de notificación y las validaciones de cada módulo salen de Users. Finance publica `FINANCE_SETTINGS_DEFAULTS`, `FINANCE_NOTIFICATION_KEYS` y los rangos de sus recordatorios desde su paquete, Intelligence mantiene los defaults de `ai` y Agenda, Projects y Health los declaran en su composición. Users valida el slug contra el registro de descriptores, aplica el parche del módulo y persiste; el reset de settings usa los defaults registrados y el resumen semanal se decide en Finance. La forma y los valores guardados no cambian.
- #319: el relay del outbox y la escritura de `domain_event_outbox` pasan de Finance a Core (`OutboxRelay`, `PrismaDomainEventOutbox` y `DomainEventsModule`); un dominio nuevo publica eventos confiables con los ports `DomainEventPublisher`, `DomainEventOutboxReader` y `DomainEventRelay` de `@personal-os/contracts` sin copiar infraestructura. Los productores de Finance dejan de inyectar el dispatcher concreto. Se conservan el esquema, los leases recuperables, el fencing por intento, los reintentos con backoff y la entrega por `EventEmitter2`.
- #360: el gateway de IA alterna los proveedores disponibles en cada inferencia y deja en enfriamiento el que responde 429 o 402 hasta el `Retry-After` que indique o, si no lo trae, 60 segundos por ritmo y 30 minutos por cupo. El respaldo sigue pasando al siguiente proveedor, la telemetría guarda el que atendió y, con todos en enfriamiento, la inferencia falla como `PROVIDER_COOLDOWN` sin llamarlos.
- FIN-1 (#317): Finance deja de poseer la ingesta de correo; retira el extractor con IA, el cifrado de tokens y los candidatos de email, conserva la importación por señales con deduplicación, reversos y transferencias, y elimina `finance.transaction.imported` y su aviso de movimiento pendiente. Los movimientos pendientes importados quedan sin aviso específico de correo hasta confirmarse.
- #308: corrige las referencias de lectura de `docs/refactors`, aclara la excepción de CI para PRs solo documentales y usa `pnpm build` como comprobación de tipos respaldada.
- El paquete de IA se renombra como `@personal-os/intelligence`; las rutas se unifican bajo `/api/intelligence/*`, Swagger usa etiquetas `intelligence*`, el módulo aplana sus carpetas y se retira el código muerto del chat anterior (#307).
- #193: el roadmap registra cerrado el gate de la oleada A tras completarse FIN-0, PLATFORM-EVENTS-0, PLATFORM-SETTINGS-0 y NOTIF-0; AI-12 (#215) permanece abierto para después de `0.100.0`.
- Los DTO de respuesta de IA y Finanzas reutilizan las constantes del dominio; el contrato publicado no cambia (#290).
- El contrato OpenAPI publica el schema de las respuestas de perfil y configuración, notificaciones, IA, autenticación y links públicos de cobros, con los montos como texto decimal y los cursores de las listas (#276, #263).
- El contrato OpenAPI publica el schema de las respuestas de categorías, comercios, monedas y tasas, analítica, entidades, Quick Entry, cargos bancarios y papelera, con los montos como texto decimal y los campos de cursor de los listados de comercios y papelera (#275, #263).
- El contrato OpenAPI publica el schema de las respuestas de presupuestos, metas de ahorro, cobros, suscripciones, recurrentes y vínculos de planificación, con montos como texto decimal y los campos de cursor de cada listado; `swagger-spec.json` se regenera (#274, #263).
- El contrato OpenAPI publica el schema de las respuestas de movimientos, transferencias, pagos de tarjeta, ajustes de saldo, conciliaciones e integridad, con montos como texto decimal y los campos de cursor de cada listado; `swagger-spec.json` se regenera (#273, #263).
- El contrato OpenAPI publica el schema de las respuestas de cuentas, tarjetas, instituciones, préstamos e importaciones de estados de cuenta, con montos como texto decimal y los campos de cursor de cada listado; `swagger-spec.json` se regenera con las rutas que faltaban (#272, #263).
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

- #475: `CODING_GUIDELINES.md` describe las reglas del stack real —tipado estricto, uniones y `switch` exhaustivo, límites medibles, async, nombres y pruebas, más controladores delgados, transacciones, N+1, DTOs, logs, dinero decimal y fechas con zona— con ejemplos de NestJS, Prisma y Jest en lugar de JavaScript genérico y PHP. Las reglas que se pueden detectar entran en `eslint.config.mjs` como `warn` (`no-explicit-any`, `complexity`, `max-depth`, `max-lines`, `max-lines-per-function`, `max-params`, `no-nested-ternary`, `no-misused-promises` y `switch-exhaustiveness-check`), así que el lint sigue en verde. `AGENTS.md` suma la guía a su orden de lectura y a su checklist.
- Se reescribe el README con banner, módulos, arquitectura, arranque, scripts y enlaces a los repos hermanos; se añade licencia MIT y archivos de comunidad (CONTRIBUTING, SECURITY y plantilla de PR).

### Corregido

- #333: la verificación individual reutiliza la última fila idéntica aunque `transaction` llegue transformado por ValidationPipe; normaliza el payload a JSON plano antes de comparar y persistir, y evita una segunda verificación en el reintento idéntico.
- #326: las pruebas E2E ignoran `.env`, usan proveedores de prueba y fallan ante cualquier intento de `fetch` a un dominio externo.
- La sincronización de Gmail informa el avance real del atraso: una fase `classifying` con los correos procesados y el total pendiente, clasificados en lotes con un tope por corrida (`AI_EMAIL_CLASSIFICATION_BUDGET_MINUTES`, 5 por defecto) en lugar de una sola pasada por ciclo, y un fallo de clasificación ya no marca el intento como fallido (#299).
- Las llamadas a la API de Gmail y al token de Google tienen límite de tiempo (30 y 15 segundos) y un vigilante marca `failed` con código `sync_stalled` una sincronización `running` sin avance (`AI_EMAIL_SYNC_STALL_MINUTES`, 15 por defecto) cuando ninguna corrida viva de este proceso tiene la conexión tomada; los errores del callback OAuth y del sync en segundo plano quedan registrados con su código saneado, y un timeout del token se reporta como `gmail_token_timeout` (#299).
- Reconectar Gmail conserva el cursor anterior de la misma cuenta para no saltarse el correo del periodo desconectado; una cuenta distinta o una primera conexión toman el `historyId` nuevo. El ciclo automático registra el fallo al listar conexiones en lugar de dejarlo sin manejar (#299).
- Gmail deja de reintentar cada 10 minutos cuando Google invalida el refresh token: la conexión queda marcada con `reconnectRequiredAt`, `GET /api/intelligence` la expone como `requiresReconnect: true`, y completar OAuth limpia la marca y reanuda la sincronización; un 429, un 5xx, un timeout, un 401/403 o un error de configuración no marcan reconexión (#281).
- Los conteos por partición de la cola de revisión aplican remitente, asunto y fechas: los chips muestran lo que queda con los filtros activos y, sin filtros, siguen mostrando los totales pendientes; el filtro de partición y el orden no los cambian (#271).
- Las importaciones de estados de cuenta facturadas a una cuenta se borran con la rama `finance.accountImports`, que «Cuentas» arrastra y la confirmación lista con su conteo; «Estados de cuenta» se queda con el resto, así ninguna importación cae sin aviso (#266).
- Vaciar «Cuentas» lista las tarjetas de débito vinculadas con su conteo y las borra; «Tarjetas» pasa a borrar solo crédito, y la cuenta de «Efectivo» se repone una sola vez aunque dos lecturas lleguen juntas (#268).
- Vaciar «Tarjetas», «Cuentas» o «Instituciones» declara en `includes` las ramas que arrastra el esquema y las ejecuta antes que la rama pedida, para que la confirmación liste lo que desaparece con su conteo y el vaciado lo borre entero (#265).
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
- #309: el exportador valida la fecha real del nombre de ronda, exige todos los IDs actuales y neutraliza fórmulas en CSV; no acepta celdas con fórmulas.

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

- Paquete de contexto del rediseño de IA, reorganizado en `docs/refactors/programs/intelligence/`: visión, estado actual, decisiones e invariantes, arquitectura objetivo (Inference Gateway, Capability Registry, Signals, Action Policy), conocimiento con evidencia append-only y alcance GLOBAL/USER, Email Intelligence V1, roadmap de 13 fases (0–12) con pruebas, demo y gate por fase, modelo de datos, capa de roles (USER | CONTRIBUTOR | ADMIN), impacto en back y web, y decisiones del dueño registradas. Solo documentación; no cambia el comportamiento.
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
