# Runbook: Gmail sync

## Pipeline

1. App pide `GET /api/finance/email-sync/oauth/google/url` (`returnTo` web). `institutionId` es opcional (compat); el flujo nuevo no lo manda.
2. OAuth tokens en `FinEmailConnection`. Sin institución en `state` no se crea `FinEmailSource`.
3. `POST /api/finance/email-sync/sources` liga institución y remitentes a un Gmail ya autorizado. Acepta `bankSenderEmails[]` (lista) y `bankSenderEmail` (compat); todos deben compartir dominio. 404 sin connection; 400 sin refresh token; 409 si la institución ya está vinculada. Si `emailSync.automatic` está on, al ligar se encola un sync incremental.
4. `GET /api/finance/email-sync/sources/:id/discovered-senders` lista otros `From` del dominio de los últimos 14 días sin llamar al modelo. `POST .../sources/:id/senders` agrega direcciones a la lista (mismo dominio, máx. 20).
5. `GET /api/finance/email-sync/mailboxes` lista buzones (incluye los sin sources). `DELETE /mailboxes/:id` desactiva connection + sources.
6. Automático (opt-in): `GmailAutoSyncScheduler` corre cada minuto y encola las fuentes vencidas al boot y en cada vuelta. La frecuencia vive por usuario en `UserModule.config.emailSync.schedule`: `{ mode: 'interval', everyMinutes }` (mínimo 15) o `{ mode: 'times', times: ['HH:MM'] }` en `User.timezone`. Sin `schedule` se usa el default de 6 h. Además: source/connection/institución activas y `emailSync.enabled` **y** `emailSync.automatic`. Incremental: Gmail `after:` + dedup; LLM solo si hay mails nuevos.
7. `POST .../sources/:id/sync` encola BullMQ `gmail-sync` si Redis (`jobId` sin `:`: `gmail-sync-{sourceId}`); si no `{ queued: false, reason }`. El manual usa el mismo `jobId` que el automático, así que un reintento de la misma petición no encola un segundo sync del origen mientras el primero siga en vuelo; `forceFullSync=true` también deduplica. El `jobId` solo deduplica un job **en vuelo**: se libera al terminar (`removeOnComplete`/`removeOnFail` en `gmail-sync.constants.ts`) para que el siguiente slot del horario pueda encolar. `forceFullSync=true` omite `after:`. Si el handler no responde en 8 s, el `Idempotency-Key` queda retenido (ver `docs/infrastructure/errors-and-envelope.md`).
8. `ProcessGmailSyncUseCase`: consulta `from:(a OR b)` con la lista; con un solo remitente `from:a`; sin lista `from:{bankDomain}`. Luego `after` salvo `forceFullSync`.
9. Dedup de correo: `(sourceId, gmailMessageId)` en `FinEmailMessage`. Además, antes de importar se descarta el cobro repetido contra transacciones `PENDING`/`CONFIRMED` del usuario: por `bankReference` (`FinTransaction.externalReference`) o, si falta, por destino + monto + moneda + tipo + comercio y `transactionDate` dentro de ±10 min. El correo queda `SKIPPED_DUPLICATE` y no crea fila. Un `SKIPPED_NOT_TX` cuyo motivo mencione nómina, depósito o monto se vuelve a extraer en el siguiente sync del mismo mensaje.
10. Cuerpo: partes `text/plain` o `text/html`; el HTML se limpia tanto en subpartes como en `payload.body` raíz (sin tablas ni estilos).
11. LLM Zod union `kind: transaction | pending_amount | not_transaction` + hints `instrumentHint` / `lastFourHint` (PAN) / `accountNumberHint` (cuenta, 4+; nunca cédula) + `bankReference` (referencia o autorización; nunca cédula, teléfono ni OTP). Nómina/depósito sin monto visible da `pending_amount` y queda `PENDING_AMOUNT` para completar el importe a mano; nunca se inventa el salario.
12. Clase de movimiento: `PURCHASE`, `INCOME`, `PAYROLL`, `ATM_WITHDRAWAL`, `TRANSFER_OUT`, `TRANSFER_IN`, `FEE`, `REFUND`, `OTHER`. Transferencias y retiros no llevan categoría de gasto/ingreso.
13. Match único: CARD por lastFour; ACCOUNT por `accountNumberLast4` (un hint completo o enmascarado cuenta si termina en esos 4 dígitos). Si no hay dígitos y hay varias cuentas, se usa la cuenta marcada `isDefaultForInstitution` solo cuando el movimiento no es transferencia ni retiro. Si no, `PENDING_ASSIGNMENT`.
14. Retiro en cajero: con una única cuenta `CASH` activa se crea transferencia banco/cuenta a efectivo (dos patas, `transferGroupId`). Sin cuenta CASH o con varias, queda pendiente.
15. Transferencias: la pata sin par se guarda sin categoría como transferencia sin par. En cada sync, un segundo pase (`TransferMatch`) busca par por sentido opuesto, mismo monto (con tolerancia de comisión), misma moneda, distinta institución y fecha dentro de 3 días; si hay un único candidato, las une con `transferGroupId`. También corrige gastos/ingresos ya importados que en realidad son transferencias y completa retiros en cajero ya importados como gasto, mirando hasta un año atrás.
16. `not_transaction` da `SKIPPED_NOT_TX`; `ok:false retryable:false` da `FAILED_NON_RETRYABLE`; retryable true no se persiste.
17. Reversos: el original se busca por `reverseOriginalRef` (`externalReference`), `reverseOfEmailMessageId` y candidatos (±14 días). Si el original ya está `REVERSED`, el aviso repetido queda `SKIPPED_DUPLICATE`. Si no aparece, el correo queda `PENDING_REVERSE` con su extract y un pase en cada sync lo reintenta (máx. 50).
18. Cola previa: en cada sync se reprocesan las filas `PENDING_ASSIGNMENT` desde el extract guardado (sin Gmail ni modelo) y se clasifican con las reglas 12 a 15.
19. Review: `GET pending`; `POST pending/:id/assign` XOR account/card misma institución; `POST pending/:id/retry` re-resuelve; `POST pending/:id/amount` completa el importe de un `PENDING_AMOUNT`. Idempotente si ya `IMPORTED`.
20. Success: `FinEmailSyncLog` + outbox `finance.email_sync.completed` misma TX.
21. Retención: `EmailMessageRetentionScheduler` corre a diario (04:00) y pone en NULL `FinEmailMessage.extractedPayload` de las filas con más de 30 días, por lotes de 1.000. La fila se conserva para dedup (`gmailMessageId`/`fingerprint`) y las transacciones no se tocan. Un mensaje `PENDING` de más de 30 días ya no puede re-extraerse desde el payload.

## Preconditions

Mailbox con tokens, source active, `emailSync.enabled`, institución owned. Cola `gmail-sync` (Redis) para enqueue. Cuenta `CASH` activa única solo si se quieren importar retiros en cajero.

## Diagnóstico

- `queued: false` es Redis/BullMQ off.
- Cola revisión: match no único; el picker solo mira activos de esa institución; la cuenta predeterminada solo aplica sin dígitos y fuera de transferencias/retiros.
- Nómina/depósito sin monto: queda `PENDING_AMOUNT`; completar con `POST pending/:id/amount`.
- Sync no encuentra mails: agregar el remitente real con `GET discovered-senders` + `POST senders`.
- Automático no corre: `emailSync.enabled` o `emailSync.automatic` false (Ajustes de Finanzas), source inactiva, o la frecuencia configurada aún no vence (intervalo u horas fijas en la zona del usuario).
- El auto-sync loguea `Custom Id cannot contain :`: el `jobId` lleva `:` y BullMQ v5 lo rechaza. Usar ids sin `:` (`gmail-sync-{sourceId}`, `ai-*-{id}`).
- El auto-sync encola una vez pero el siguiente slot no arranca: el `jobId` quedó retenido. `GMAIL_SYNC_JOB_OPTIONS` debe liberar el id con `removeOnComplete: true` y `removeOnFail: true`.
- Moneda `RDS` o `RD$` en un correo: los bancos locales escriben el peso así. `normalizeCurrencyCode` lo mapea a `DOP` (el prompt del extractor también lo pide), y `DOP->DOP` es identidad, sin llamada a FX.
- Un solo correo con error de import o FX ya no tumba el sync: queda `FAILED_NON_RETRYABLE` con el motivo y el lote sigue; `lastSyncedAt` avanza. Solo los errores de lectura de Gmail (list/get/token) fallan el job entero.
- `Unsupported state or unable to authenticate data` (AES-GCM): el `ENCRYPTION_KEY` no coincide con el que cifró `FinEmailConnection`, o el ciphertext está corrupto. El error ahora dice `Gmail tokens could not be decrypted. Reconnect the mailbox.` Confirmar la key de producción; si no, reconectar Gmail en Correos (OAuth nuevo). No rotar la key a ciegas ni meter secrets en el repo.
- Cobro duplicado omitido: el correo queda `SKIPPED_DUPLICATE` y el motivo apunta a la transacción existente.
- Reverso sin cargo original: el correo queda `PENDING_REVERSE` y se reintenta en cada sync.
- Transferencia contabilizada como gasto/ingreso: el pase de empareje la une en el siguiente sync; si no hay par único, revisar monto, fecha e institución.

Evidencia: `process-gmail-sync.use-case.ts` + `route-extracted-email.use-case.ts` + `resolve-reverse-original.ts` + `retry-pending-reverses.use-case.ts` + `gmail-sync-schedule.ts` + `gmail-sync.constants.ts` + `token-encryption.util.ts` + `account-number-encryption.util.ts` + `email-message-retention.scheduler.ts` + `shared/domain/money.ts` + `match-email-transfers.ts` + `backfill-pending-email.use-case.ts` + `enqueue-due-gmail-syncs.use-case.ts` + `ingestion.service.ts` + specs.
