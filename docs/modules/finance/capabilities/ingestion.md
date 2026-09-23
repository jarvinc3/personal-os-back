# Capacidad: ingestion (Gmail)

`FinEmailConnection` = buzón OAuth unique `(userId, provider, emailAddress)`. `FinEmailSource` = vínculo de un banco a ese buzón: `institutionId` + `bankSenderEmail` (correo From de notificaciones). Unique `(userId, institutionId)`: una institución, un buzón. `bankDomain` se deriva del remitente y queda como fallback de filas viejas. No es destino de ledger.

Destino se resuelve por match único de tarjeta `lastFour` o cuenta única de esa institución; 0 o N → `PENDING_ASSIGNMENT` (sin fila ledger).

Tokens cifrados. Job BullMQ `gmail-sync`. Extractor LLM (`AiEmailTransactionExtractor`) vía `AiCoreModule` (sin `forwardRef`). Sync automático (opt-in `emailSync.automatic`) al ligar un banco, al boot de la API y cada 6 h si `lastSyncedAt` está vencido.

OAuth autoriza **solo el buzón**. Ligar un banco es `POST /api/finance/email-sync/sources` (exige connection con refresh token). Callback sin `institutionId` en `state` no crea source.

Callback público 302:

- Mobile default: `personal-os://finance/oauth/callback?success=1|false`
- Web: `returnTo` https cuyo origin está en `CORS_ORIGIN`, firmado en `state`. Inválido → deep link móvil (no open redirect).

Ver [operations/gmail-sync.md](../operations/gmail-sync.md).
