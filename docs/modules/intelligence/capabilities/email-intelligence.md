# Email Intelligence (AI-2, AI-5)

`/api/intelligence` exposes the Gmail source and its imported messages to the authenticated account. OAuth requests Gmail read-only scope; signed state binds the callback to the initiating user. Access and refresh tokens are encrypted with the dedicated `AI_GMAIL_TOKEN_ENCRYPTION_KEY`.

The first sync paginates from 2026-01-01. Later syncs use the persisted Gmail history cursor; an expired cursor recovers from the last successful sync, paginating the whole gap. If the provider cannot complete it, the progress state keeps the attempted `recoveryRange` and the attempt is not reported as a full success. Without a last successful sync, recovery falls back to the last seven days. The dashboard marks the bootstrap complete only after Gmail returns the last page and includes the earliest and latest persisted message dates. The messages endpoint paginates oldest-first so the historical start is visible immediately. Message identity is unique per connection and provider message ID, so retries do not duplicate rows. All message reads filter by `userId`; a composite foreign key keeps a message attached to its owner's connection.

Connecting Gmail can set an import scope: `period` (`TODAY`, `LAST_MONTH`, `LAST_3_MONTHS`) resolves to a UTC start date and optional `senderFilter` bounds the sender domain. Both are persisted on the connection as `importStartAt` and `senderFilter` and exposed by the dashboard. The bootstrap and recovery add `after:` and `from:` to the Gmail query; the incremental history endpoint accepts no query, so messages older than the start date or from another sender are discarded before they are stored. The scoped BHD pilot sync also honors the connection scope: it intersects its own window with the saved start date, narrows the sender to the most specific of BHD and the saved filter (rejecting a disjoint one), and pre-filters metadata when the connection has a scope. Without an explicit period the connection keeps the previous behavior, so older clients still bootstrap from 2026-01-01. Reconnecting with a new period moves the cut forward; it never deletes already imported mail.

Sync progress is persisted on the user's connection so refreshes can recover its current stage, page counters, retry wait, next scheduled tick, recovery range, and safe failure category. The connection also keeps the last attempt (start, finish, result, safe error code and category, imported count, and phase) and the last failure separately. A successful attempt clears the current error but preserves the previous failure; a worker restart records the attempt as `INTERRUPTED`, not as a Gmail failure. `GET /api/intelligence` exposes both records as `lastAttempt` and `lastFailure`, without message content, subjects, addresses, or tokens. The authenticated notifications socket emits `ai.email.sync.updated` to the owning user's room; the REST dashboard remains the durable snapshot. The scheduler resumes the next bootstrap page every configured interval (10 minutes by default), so a completed page with more history is shown as scheduled rather than stopped.

Sync progress also reports the `classifying` phase: after the Gmail phase, the connection classifies the pending backlog in batches of up to 100 messages and writes `processedThisRun` against the `totalEstimate` of pending mail. Each run stops at `AI_EMAIL_CLASSIFICATION_BUDGET_MINUTES` (5 by default), so the next scheduled tick still happens while the backlog drains. A failed classification does not fail the sync attempt: the backlog stays scheduled with code `classification_failed`. A watchdog marks any stored `running` state older than `AI_EMAIL_SYNC_STALL_MINUTES` (15 by default) as `failed` with code `sync_stalled`, but only when no sync in this process holds the connection; hung calls of a live run are cut by the HTTP timeouts.

When Google invalidates the refresh token (`invalid_grant`) or the connection has no refresh token, the connection is marked with `reconnectRequiredAt` and the dashboard exposes `requiresReconnect: true`. The automatic cycle skips those connections and does not schedule another attempt until the user completes OAuth again; the callback clears the mark and resumes normal synchronization. A 429, a 5xx, a timeout, a 401/403, or a configuration error does not mark reconnection. Reconnecting the same account keeps the previous history cursor, so the next sync reads the history since the last successful sync instead of jumping to now; an expired cursor falls back to the recovery window. A first connection or a different account takes the new `historyId`. Both callback failures, the OAuth exchange and the background sync, are logged with a safe code instead of being discarded.

Gmail quota errors honor the provider's `Retry-After` value, bounded between 1 and 30 seconds. When Gmail omits it, the backend shows a visible exponential wait of 5, 10, and 20 seconds before its three retries. If the quota remains exhausted, the connection stays in `waiting` and schedules another automatic attempt after 1, 2, 4, 8, then at most 15 minutes; the retry time is persisted and resumed after a worker restart. The incremental history read uses the same retries and retry states as the rest of the Gmail calls. Every Gmail API call aborts after 30 seconds and every token call after 15 seconds; a timed-out Gmail call uses the same bounded retries, and a timed-out token call surfaces as a temporary failure.

At startup, if the OAuth variables are missing, `onModuleInit` logs a safe warning and does not schedule the automatic cycle. The authenticated `GET /api/intelligence/email/oauth/diagnostics` reports `missing_oauth_configuration` without exposing values; after the variables are set and the API restarts, it reports `ready` and the cycle starts. An existing connection is not healthy while that status is incomplete.

Errors are classified as `configuration`, `authorization`, `rate_limit`, `temporary` or `unknown`. The safe provider code is kept in `errorCode` (or in `providerErrorCode` when a retry is scheduled) so the dashboard can show a concrete cause: `gmail_oauth_not_configured` stays a configuration error, `401`/`403`/`insufficientPermissions` become authorization errors, and an unrecognized provider code remains available instead of a generic exception message. Only `invalid_grant` and a missing refresh token stop the automatic cycle and require reconnection; the other authorization errors remain retryable. A worker restart mid-run is recorded as `worker_interrupted`.

Endpoints:

- `GET /api/intelligence`: connection, counts, current role, first/latest received-message dates, and `requiresReconnect` for the Gmail source.
- `GET /api/intelligence/messages?cursor=...`: keyset-paginated summaries ordered oldest-first.
- `GET /api/intelligence/messages/:messageId`: the caller's message and available body representations.
- `POST /api/intelligence/email/connect` accepts an optional `{ period, senderFilter }` and returns the authorization URL; `POST /api/intelligence/email/sync`.
- `POST /api/intelligence/email/reset` with `{ "confirmed": true }` removes this user's imported mail and derived review/analysis data, resets bootstrap cursors, and retains the OAuth connection. Without a connection it returns 409 `GMAIL_NOT_CONNECTED`; while a sync is active or waiting for quota it returns 409 `GMAIL_SYNC_IN_PROGRESS` and deletes nothing.
- `GET /api/intelligence/email/oauth/callback`: public OAuth callback; the signed state is validated before persisting tokens.
- `GET|PATCH /api/intelligence/preferences/consent`: contribution consent, enabled by default and revocable. Revoking it pauses GLOBAL knowledge and rebuilds the projection.
- `GET /api/intelligence/admin/roles` and `PATCH /api/intelligence/admin/roles/:userId`: ADMIN-only role management.

Raw message bodies are purged 30 days after ingestion in DEV and 7 days after ingestion in PROD; canonical and sanitized representations remain available for this phase. New tables enable RLS and revoke `PUBLIC`, `anon`, and `authenticated` access where those roles exist. The backend accesses them through Prisma.

## Clasificación (AI-5)

Los formatos fijos de `bhd.com.do` se leen del texto antes de llamar al modelo, y solo cuando el correo no encaja en ninguno se usa la IA con rotación de proveedores. El lector reconoce tres movimientos y un aviso: la alerta de tarjeta (`BHD Notificación de Transacciones`), la transferencia entre productos propios (`Transacciones entre mis productos` y su variante a otros bancos), la transferencia recibida (`Notificaciones`, «Pago al Instante») y el aviso de estado de cuenta. De cada uno toma la fecha, la moneda, el monto, la dirección, la clase, el comercio o contraparte, la referencia y los últimos 4 que el banco escribe, con confianza fija `0.99` y método `DETERMINISTIC`; la respuesta no cambia cuando rota el proveedor y no consume tokens ni presupuesto de modelo.

La clasificación de una transferencia entre productos propios cruza los últimos 4 del destino con los productos activos del dueño, que pide por el puerto `EmailProductHints` a Finance, el dominio que los posee: `creditCardLast4` y `ownProductLast4`. Solo una tarjeta de crédito se cobra como `CARD_PAYMENT`, porque el pago de Finance exige una tarjeta de crédito. Una cuenta o una tarjeta de débito queda `TRANSFER_OUT` con la cuenta de origen en `accountNumberLast4`. La variante a otros bancos también queda `TRANSFER_OUT` cuando el origen es una cuenta del dueño: el correo declara que el destino no es un producto propio, así que el lado de salida no es ambiguo y no se inventa contraparte. Cuando el destino no es ninguno de los productos registrados en la variante entre productos, la clase queda `OTHER` con dirección `TRANSFER`: el motor lo manda a revisión con `TRANSFER_DIRECTION_AMBIGUOUS` sin inventar el lado ni el producto. Un correo que no trae las columnas completas, o un dominio sin el puerto disponible, no se clasifica de forma determinista y sigue el camino del modelo.

En la muestra de auditoría de recall el modelo se sigue llamando, pero solo mide: si el texto ya fijó la clasificación, esa manda y el modelo no sobrescribe campos ni método, y la ejecución queda marcada como muestra de auditoría. Issue: [#370](https://github.com/jarvinc3/personal-os-back/issues/370).

After each successful Gmail sync, the classifier drains the pending backlog in bounded batches under their owning user, for up to `AI_EMAIL_CLASSIFICATION_BUDGET_MINUTES` (5 by default); the rest stays scheduled for the next tick. Stable knowledge lookup checks USER sender/domain/template entries first and falls back to GLOBAL structural knowledge. A known template is parsed deterministically; an irrelevant known label avoids a model call except for a deterministic 1/100 recall-audit sample, limited to consenting ADMIN accounts. Every model proposal is validated again against the closed semantic and route schemas before it is stored.

Two model deviations are normalized before validation because the closed rules, not the email, decide them: a semantic type that does not admit a transaction drops a `transaction` object that states no movement, meaning one that only carries `kind: NOT_TRANSACTION` or an attempt left in `DECLINED`, `REJECTED`, `FAILED`, `CANCELLED` or `VOIDED`; and a `SECURITY_OTP` is never financially relevant. Any other object stays untouched for validation to reject, so an approved amount never disappears from a notice. The schema sent to the provider does not offer `NOT_TRANSACTION`, and the prompt asks to omit `transaction` when the message states no candidate. Any other rejection triggers one repair call with the rejection detail; if that also fails, the message stays unclassified and moves to `REVIEW_REQUIRED`. The failure records whether the parsing failed (`INVALID_JSON`) or which field was rejected, never the message body. Issue: [#351](https://github.com/jarvinc3/personal-os-back/issues/351).

Para los correos de `bhd.com.do`, un anclaje determinista revisa el texto después del modelo. La fecha se lee como día/mes/año con hora local de America/Santo_Domingo (UTC-4); `transactionDate` solo se guarda cuando hay exactamente una fecha y hora válidas y cercanas a la recepción. Si no se pueden verificar, se descarta la fecha del modelo y queda la sugerencia del encabezado para revisión. La moneda se contrasta con `RD$`/`DOP` y `US$`/`USD`: si el texto contradice al modelo, gana el texto y `currencyEvidence` conserva la diferencia; si el texto no declara moneda, no se guarda una moneda sin verificar. Un correo BHD de reverso, reversión, reembolso, devolución o contracargo se fuerza a `REFUND`, dirección `CREDIT` y estado de reverso, salvo que el texto diga que el pago no se aplicó. Issue: [#363](https://github.com/jarvinc3/personal-os-back/issues/363).

El mismo anclaje fija la clase y el lado del movimiento cuando la plantilla BHD los declara. La alerta de tarjeta trae una fila con fecha, moneda, monto, comercio, estado y tipo: si el tipo es `Compra` y el monto de la fila coincide con el del movimiento, la clasificación queda como `PURCHASE` con dirección `DEBIT`, así que una compra en un comercio nunca se guarda como pago de tarjeta y una dirección ausente se completa con el texto. Si el monto no coincide, la fila no se usa. Un correo con `Producto origen` y `Producto destino` fija el lado en `TRANSFER_OUT`, porque el dinero sale del producto de origen, y conserva la clase que trajo el modelo, de modo que el pago de tarjeta que usa el mismo formato sigue siendo `CARD_PAYMENT`. Issue: [#366](https://github.com/jarvinc3/personal-os-back/issues/366).

The pipeline stores one `AiEmailClassification` and one `EMAIL_CLASSIFICATION` observation for each independent route in the message's `ANALYZE_ONLY` run. When there are no routes, a `NONE` classification row and a `null` route observation preserve the proposal. Low confidence and audit samples become `REVIEW_REQUIRED`. `AI_EMAIL_DAILY_MODEL_BUDGET` caps gateway calls per user and UTC day (default 100); exhausted messages stay `QUEUED`, and later scheduled sync cycles resume them after the budget resets. The budget table is updated atomically per user. Classification records are evidence only: they never create or import Finance movements. Email contents are untrusted data and cannot change system instructions.

`GET /api/intelligence/messages/:messageId` exposes classification rows with route, labels, confidence, decision path, knowledge used, provider and model, alongside append-only provenance observations. Each read is scoped to the authenticated user. The web detail panel shows each proposed route and its inference provenance; it states no financial movement is created.

The email-import contract adds `accountNumberLast4`, `CARD_PAYMENT`, `suggestedTransactionDate` with `suggestedTransactionDateSource: EMAIL_HEADER`, and `reverseOfEmailMessageId`. The classifier emits them: the schema and prompt include the hints, and the pipeline fills the suggested date from the message header outside the model while `transactionDate` stays absent when the email does not state it. The Finance consumer still does not use the suggestion or the reversal chain. Finance owns the contract: [email-import.md](../../finance/contracts/email-import.md). Issues: [#334](https://github.com/jarvinc3/personal-os-back/issues/334), [#335](https://github.com/jarvinc3/personal-os-back/issues/335), [#337](https://github.com/jarvinc3/personal-os-back/issues/337) and [#336](https://github.com/jarvinc3/personal-os-back/issues/336).

Verificar un correo o un lote de revisión reclasifica además los correos ya clasificados de la misma plantilla: mismo `fromAddress` y misma huella `templateFingerprint`, en `PROCESSED` o `REVIEW_REQUIRED`, sin verificación humana y fuera de HOLDOUT. Una huella nula no se generaliza: la verificación de un correo sin plantilla no toca otros correos. La etiqueta verificada aporta solo la estructura (relevancia, tipo, rutas y `transaction.kind`); el monto, la moneda y la cuenta salen de la clasificación propia de cada correo. Sin esos datos la señal llega a Finance y queda en revisión, nunca se inventa un movimiento. La pasada no llama al modelo, registra `decisionPath: KNOWLEDGE`, `knowledgeUsed` con las claves compartidas y un run `ANALYZE_ONLY` con la versión del proyector. Reejecutarla reemplaza las filas de clasificación del correo y conserva una sola señal `FINANCE.*` por mensaje, así que Finance no duplica el movimiento. El límite por pasada es de 5000 correos y el resto queda para la siguiente verificación. Si la pasada falla, su run queda `FAILED` con el código seguro y la fecha de cierre; el reintento crea un run nuevo y conserva el anterior para auditoría.

Repetir la misma verificación con el mismo veredicto, etiquetas y nota no agrega otra fila append-only: reutiliza la última idéntica y vuelve a intentar la reclasificación. Si la reclasificación falla, la petición responde error después de guardar la verificación; el reintento es seguro, libera los correos que quedaron en `CLASSIFYING` y no duplica evidencia.

## Propuestas de productos detectados (#368)

El proceso de propuestas lee mensajes y señales ya persistidos; no inicia OAuth,
no sincroniza Gmail, no reclasifica con IA y no escribe productos durante el
descubrimiento. `POST /api/intelligence/email/product-proposals/discover`
revisa hasta 200 señales BHD en `ROUTED` cuyo preview de Finance muestra un
bloqueo de destino. Reconoce solo etiquetas explícitas de tarjeta BHD y la
cuenta propia que indica la clase: `Producto origen` en `TRANSFER_OUT` y en
`CARD_PAYMENT`, y en `TRANSFER_IN` el `Producto destino` o la etiqueta
`Producto :` de la transferencia recibida. El número del producto son los cuatro
dígitos finales del token completo: un IBAN enmascarado como
`DO26BCBH000000000XXXXXXX0016` da `0016`, no `0000`. Ese número se confirma
contra `accountNumberLast4` de la señal; si no coincide, no hay propuesta ni
evidencia, y la evidencia guarda la etiqueta y el lado que aportaron el número.
La contraparte, el ordenante y el banco de origen nunca se proponen. Un destino no registrado no se adivina como
tarjeta ni como cuenta. Identificar el lado o el tipo con ambigüedad no produce
propuesta.

`GET /api/intelligence/email/product-proposals` lista las propuestas con
asunto, dominio, fecha e indicio mínimo de cada correo de origen. La evidencia
no incluye cuerpos ni números completos. Cada propuesta trae
`matchedInstitutionId` (o `matchedInstitutionIds` cuando hay varias
instituciones compatibles) y `matchedProductId` (o `matchedProductIds` cuando
hay varios productos). La institución se compara con la misma regla con la que
Finance la reutiliza (dominio o nombre normalizado) y un producto compatible es
uno activo, del tipo de la propuesta y con los mismos últimos 4. Con
`matchedProductId` la web ofrece vincular el producto existente en lugar de
crear uno. `PATCH .../:proposalId` deja de usarse desde la web y se mantiene por
compatibilidad.

`POST /api/intelligence/email/product-proposals/:proposalId/approve` acepta
`{ productId }` y es el único paso que aprueba. Con `productId` valida que el
producto sea del usuario, esté activo, sea del tipo de la propuesta y no
pertenezca a Efectivo; vincula sin crear nada, deja `approvedProductId`, guarda
los últimos 4 finales del producto si el usuario los cambió en el formulario
nativo y reevalúa las señales. Repetirlo con el mismo producto es idempotente y
con otro responde 409. Sin cuerpo conserva el comportamiento anterior: crea o
reutiliza el producto desde el borrador (`duplicate: true` si ya existía) y
nunca duplica una institución compatible. `POST .../:proposalId/discard`
descarta una propuesta pendiente. Las rutas responden 404 en producción. Cada
propuesta se deduplica por usuario, institución, tipo de producto y últimos
cuatro, y la evidencia por mensaje es única.

El descubrimiento no crea una propuesta cuando ya existe un producto activo
compatible con los mismos últimos 4: lo cuenta en `alreadyExists` o en
`ambiguous` si hay varios. Un producto archivado no cuenta como existente y la
propuesta se puede volver a detectar. Si ya había una propuesta PENDING para ese
producto, la evidencia nueva se le sigue sumando y el listado la marca con
`matchedProductId` para vincularla.

Una cuenta requiere tipo y últimos cuatro antes de aprobar. El número completo
es opcional: si se proporciona se cifra con `DATA_ENCRYPTION_KEY` y el API solo
expone si existe y sus últimos cuatro. Puede añadirse, reemplazarse o borrarse
después con `PATCH /api/finance/accounts/:id`. Tras aprobar, Finance vuelve a
evaluar las señales en revisión asociadas a los correos de evidencia; la clave
de importación de la señal mantiene idempotente la creación del movimiento.

Configure `AI_GMAIL_CLIENT_ID`, `AI_GMAIL_CLIENT_SECRET`, `AI_GMAIL_REDIRECT_URI`, and the dedicated 32-character `AI_GMAIL_TOKEN_ENCRYPTION_KEY` in DEV. Set `AI_DEV_ADMIN_EMAIL` to seed the development administrator. This configuration is not applied to production as part of AI-2.
