# Runbook: Gmail sync

## Pipeline

1. App pide `GET /api/finance/email-sync/oauth/google/url` (`institutionId` + `returnTo` web).
2. OAuth tokens en `FinEmailConnection`.
3. `POST .../sources/:id/sync` encola BullMQ `gmail-sync` si Redis; si no `{ queued: false, reason }`.
4. `ProcessGmailSyncUseCase`: lista `from:{bankDomain}` + `after` salvo `forceFullSync`.
5. Dedup `(sourceId, gmailMessageId)` en `FinEmailMessage`.
6. LLM Zod union `kind: transaction | not_transaction` + hints instrumento/lastFour. Sin parsers HTML por banco.
7. Match único card lastFour o cuenta única institución; si no `PENDING_ASSIGNMENT`.
8. `not_transaction` → `SKIPPED_NOT_TX`; `ok:false retryable:false` → `FAILED_NON_RETRYABLE`; retryable true no se persiste.
9. Review: `GET pending`; `POST assign` XOR account/card misma institución; `POST retry` re-resuelve. Idempotente si ya `IMPORTED`.
10. Success: `FinEmailSyncLog` + outbox `finance.email_sync.completed` misma TX.

## Preconditions

Source active, tokens, `emailSync.enabled`, institución owned.

## Diagnóstico

- `queued: false` → Redis/BullMQ off.
- Cola revisión → match no único; picker solo activos de esa institución.

Evidencia: `process-gmail-sync.use-case.ts` + specs.
