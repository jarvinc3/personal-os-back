# Capacidad: ingestion (Gmail)

`FinEmailConnection` = OAuth mailbox unique `(userId, provider, emailAddress)`. `FinEmailSource` = connection + **institution** + `bankDomain` (no es destino de ledger). Destino se resuelve por match único de tarjeta `lastFour` o cuenta única de esa institución; 0 o N → `PENDING_ASSIGNMENT` (sin fila ledger).

Tokens cifrados. Job BullMQ `gmail-sync`. Extractor LLM (`AiEmailTransactionExtractor`) vía `AiCoreModule` (sin `forwardRef`).

Callback público 302:

- Mobile default: `personal-os://finance/oauth/callback?success=1|false`
- Web: `returnTo` https cuyo origin está en `CORS_ORIGIN`, firmado en `state` + `institutionId`. Inválido → deep link móvil (no open redirect).

Ver [operations/gmail-sync.md](../operations/gmail-sync.md).
