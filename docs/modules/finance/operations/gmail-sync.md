# Runbook: Gmail sync

## Pipeline

1. App pide `GET /api/finance/email-sync/oauth/google/url` (`returnTo` web). `institutionId` es opcional (compat); el flujo nuevo no lo manda.
2. OAuth tokens en `FinEmailConnection`. Sin institución en `state` no se crea `FinEmailSource`.
3. `POST /api/finance/email-sync/sources` liga institución + `bankSenderEmail` a un Gmail ya autorizado. 404 sin connection; 400 sin refresh token; 409 si la institución ya está vinculada. Al ligar se encola un sync incremental.
4. `GET /api/finance/email-sync/mailboxes` lista buzones (incluye los sin sources). `DELETE /mailboxes/:id` desactiva connection + sources.
5. Automático: `GmailAutoSyncScheduler` encola sources due al boot y cada 6 h. Due = `lastSyncedAt` nulo o ≥ 6 h, source/connection/institución activas, `emailSync.enabled`. Incremental: Gmail `after:` + dedup; LLM solo si hay mails nuevos.
6. `POST .../sources/:id/sync` encola BullMQ `gmail-sync` si Redis (`jobId` `gmail-sync:{sourceId}`); si no `{ queued: false, reason }`. `forceFullSync=true` omite `after:`.
7. `ProcessGmailSyncUseCase`: lista `from:{bankSenderEmail ?? bankDomain}` + `after` salvo `forceFullSync`.
8. Dedup `(sourceId, gmailMessageId)` en `FinEmailMessage`.
9. LLM Zod union `kind: transaction | not_transaction` + hints instrumento/lastFour. Sin parsers HTML por banco.
10. Match único card lastFour o cuenta única institución; si no `PENDING_ASSIGNMENT`.
11. `not_transaction` → `SKIPPED_NOT_TX`; `ok:false retryable:false` → `FAILED_NON_RETRYABLE`; retryable true no se persiste.
12. Review: `GET pending`; `POST assign` XOR account/card misma institución; `POST retry` re-resuelve. Idempotente si ya `IMPORTED`.
13. Success: `FinEmailSyncLog` + outbox `finance.email_sync.completed` misma TX.

## Preconditions

Mailbox con tokens, source active, `emailSync.enabled`, institución owned. Cola `gmail-sync` (Redis) para enqueue.

## Diagnóstico

- `queued: false` → Redis/BullMQ off.
- Cola revisión → match no único; picker solo activos de esa institución.
- Sync no encuentra mails → remitente mal escrito; filas viejas siguen filtrando por dominio.
- Automático no corre → `emailSync.enabled` false, source inactiva, o `lastSyncedAt` más reciente que 6 h.

Evidencia: `process-gmail-sync.use-case.ts` + `enqueue-due-gmail-syncs.use-case.ts` + `ingestion.service.ts` + specs.
