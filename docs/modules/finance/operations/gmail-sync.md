# Runbook: Gmail sync

## Pipeline

1. App pide `GET /api/finance/email-sync/oauth/google/url` (`returnTo` web). `institutionId` es opcional (compat); el flujo nuevo no lo manda.
2. OAuth tokens en `FinEmailConnection`. Sin institución en `state` no se crea `FinEmailSource`.
3. `POST /api/finance/email-sync/sources` liga institución y remitentes a un Gmail ya autorizado. Acepta `bankSenderEmails[]` (lista) y `bankSenderEmail` (compat); todos deben compartir dominio. 404 sin connection; 400 sin refresh token; 409 si la institución ya está vinculada. Si `emailSync.automatic` está on, al ligar se encola un sync incremental.
4. `GET /api/finance/email-sync/sources/:id/discovered-senders` lista otros `From` del dominio de los últimos 14 días sin llamar al modelo. `POST .../sources/:id/senders` agrega direcciones a la lista (mismo dominio, máx. 20).
5. `GET /api/finance/email-sync/mailboxes` lista buzones (incluye los sin sources). `DELETE /mailboxes/:id` desactiva connection + sources.
6. Automático (opt-in): `GmailAutoSyncScheduler` corre cada minuto y encola las fuentes vencidas al boot y en cada vuelta. La frecuencia vive por usuario en `UserModule.config.emailSync.schedule`: `{ mode: 'interval', everyMinutes }` (mínimo 15) o `{ mode: 'times', times: ['HH:MM'] }` en `User.timezone`. Sin `schedule` se usa el default de 6 h. Además: source/connection/institución activas y `emailSync.enabled` **y** `emailSync.automatic`. Incremental: Gmail `after:` + dedup; LLM solo si hay mails nuevos.
7. `POST .../sources/:id/sync` encola BullMQ `gmail-sync` si Redis (`jobId` `gmail-sync:{sourceId}`); si no `{ queued: false, reason }`. `forceFullSync=true` omite `after:`.
8. `ProcessGmailSyncUseCase`: consulta `from:(a OR b)` con la lista; con un solo remitente `from:a`; sin lista `from:{bankDomain}`. Luego `after` salvo `forceFullSync`.
9. Dedup de correo: `(sourceId, gmailMessageId)` en `FinEmailMessage`. Además, antes de importar se descarta el cobro repetido contra transacciones `PENDING`/`CONFIRMED` del usuario: por `bankReference` (`FinTransaction.externalReference`) o, si falta, por destino + monto + moneda + tipo + comercio y `transactionDate` dentro de ±10 min. El correo queda `SKIPPED_DUPLICATE` y no crea fila. Un `SKIPPED_NOT_TX` cuyo motivo mencione nómina, depósito o monto se vuelve a extraer en el siguiente sync del mismo mensaje.
10. Cuerpo: partes `text/plain` o `text/html`; el HTML se limpia tanto en subpartes como en `payload.body` raíz (sin tablas ni estilos).
11. LLM Zod union `kind: transaction | pending_amount | not_transaction` + hints `instrumentHint` / `lastFourHint` (PAN) / `accountNumberHint` (cuenta, 4+; nunca cédula) + `bankReference` (referencia o autorización; nunca cédula, teléfono ni OTP). Nómina/depósito sin monto visible da `pending_amount` y queda `PENDING_AMOUNT` para completar el importe a mano; nunca se inventa el salario.
12. Clase de movimiento: `PURCHASE`, `INCOME`, `PAYROLL`, `ATM_WITHDRAWAL`, `TRANSFER_OUT`, `TRANSFER_IN`, `FEE`, `REFUND`, `OTHER`. Transferencias y retiros no llevan categoría de gasto/ingreso.
13. Match único: CARD por lastFour; ACCOUNT por número completo o sufijo (p. ej. `****5678`). Si no hay dígitos y hay varias cuentas, se usa la cuenta marcada `isDefaultForInstitution` solo cuando el movimiento no es transferencia ni retiro. Si no, `PENDING_ASSIGNMENT`.
14. Retiro en cajero: con una única cuenta `CASH` activa se crea transferencia banco/cuenta a efectivo (dos patas, `transferGroupId`). Sin cuenta CASH o con varias, queda pendiente.
15. Transferencias: la pata sin par se guarda sin categoría como transferencia sin par. En cada sync, un segundo pase (`TransferMatch`) busca par por sentido opuesto, mismo monto (con tolerancia de comisión), misma moneda, distinta institución y fecha dentro de 3 días; si hay un único candidato, las une con `transferGroupId`. También corrige gastos/ingresos ya importados que en realidad son transferencias y completa retiros en cajero ya importados como gasto, mirando hasta un año atrás.
16. `not_transaction` da `SKIPPED_NOT_TX`; `ok:false retryable:false` da `FAILED_NON_RETRYABLE`; retryable true no se persiste.
17. Reversos: el original se busca por `reverseOriginalRef` (`externalReference`), `reverseOfEmailMessageId` y candidatos (±14 días). Si el original ya está `REVERSED`, el aviso repetido queda `SKIPPED_DUPLICATE`. Si no aparece, el correo queda `PENDING_REVERSE` con su extract y un pase en cada sync lo reintenta (máx. 50).
18. Cola previa: en cada sync se reprocesan las filas `PENDING_ASSIGNMENT` desde el extract guardado (sin Gmail ni modelo) y se clasifican con las reglas 12 a 15.
19. Review: `GET pending`; `POST pending/:id/assign` XOR account/card misma institución; `POST pending/:id/retry` re-resuelve; `POST pending/:id/amount` completa el importe de un `PENDING_AMOUNT`. Idempotente si ya `IMPORTED`.
20. Success: `FinEmailSyncLog` + outbox `finance.email_sync.completed` misma TX.

## Preconditions

Mailbox con tokens, source active, `emailSync.enabled`, institución owned. Cola `gmail-sync` (Redis) para enqueue. Cuenta `CASH` activa única solo si se quieren importar retiros en cajero.

## Diagnóstico

- `queued: false` es Redis/BullMQ off.
- Cola revisión: match no único; el picker solo mira activos de esa institución; la cuenta predeterminada solo aplica sin dígitos y fuera de transferencias/retiros.
- Nómina/depósito sin monto: queda `PENDING_AMOUNT`; completar con `POST pending/:id/amount`.
- Sync no encuentra mails: agregar el remitente real con `GET discovered-senders` + `POST senders`.
- Automático no corre: `emailSync.enabled` o `emailSync.automatic` false (Ajustes de Finanzas), source inactiva, o la frecuencia configurada aún no vence (intervalo u horas fijas en la zona del usuario).
- Cobro duplicado omitido: el correo queda `SKIPPED_DUPLICATE` y el motivo apunta a la transacción existente.
- Reverso sin cargo original: el correo queda `PENDING_REVERSE` y se reintenta en cada sync.
- Transferencia contabilizada como gasto/ingreso: el pase de empareje la une en el siguiente sync; si no hay par único, revisar monto, fecha e institución.

Evidencia: `process-gmail-sync.use-case.ts` + `route-extracted-email.use-case.ts` + `resolve-reverse-original.ts` + `retry-pending-reverses.use-case.ts` + `gmail-sync-schedule.ts` + `match-email-transfers.ts` + `backfill-pending-email.use-case.ts` + `enqueue-due-gmail-syncs.use-case.ts` + `ingestion.service.ts` + specs.
