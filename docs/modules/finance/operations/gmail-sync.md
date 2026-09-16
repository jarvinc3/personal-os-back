# Runbook: Gmail sync

## Pipeline

1. App pide `GET /api/finance/email-sync/oauth/google/url` (`returnTo` web). `institutionId` es opcional (compat); el flujo nuevo no lo manda.
2. OAuth tokens en `FinEmailConnection`. Sin institución en `state` no se crea `FinEmailSource`.
3. `POST /api/finance/email-sync/sources` liga institución + `bankSenderEmail` a un Gmail ya autorizado. 404 sin connection; 400 sin refresh token; 409 si la institución ya está vinculada.
4. `GET /api/finance/email-sync/mailboxes` lista buzones (incluye los sin sources). `DELETE /mailboxes/:id` desactiva connection + sources.
5. `POST .../sources/:id/sync` encola BullMQ `gmail-sync` si Redis; si no `{ queued: false, reason }`.
6. `ProcessGmailSyncUseCase`: lista `from:{bankSenderEmail ?? bankDomain}` + `after` salvo `forceFullSync`.
7. Dedup `(sourceId, gmailMessageId)` en `FinEmailMessage`.
8. LLM Zod union `kind: transaction | not_transaction` + hints instrumento/lastFour. Sin parsers HTML por banco.
9. Match único card lastFour o cuenta única institución; si no `PENDING_ASSIGNMENT`.
10. `not_transaction` → `SKIPPED_NOT_TX`; `ok:false retryable:false` → `FAILED_NON_RETRYABLE`; retryable true no se persiste.
11. Review: `GET pending`; `POST assign` XOR account/card misma institución; `POST retry` re-resuelve. Idempotente si ya `IMPORTED`.
12. Success: `FinEmailSyncLog` + outbox `finance.email_sync.completed` misma TX.

## Preconditions

Mailbox con tokens, source active, `emailSync.enabled`, institución owned.

## Diagnóstico

- `queued: false` → Redis/BullMQ off.
- Cola revisión → match no único; picker solo activos de esa institución.
- Sync no encuentra mails → remitente mal escrito; filas viejas siguen filtrando por dominio.

Evidencia: `process-gmail-sync.use-case.ts` + `ingestion.service.ts` + specs.
