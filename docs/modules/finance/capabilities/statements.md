# Capacidad: statements

Estados de cuenta (ciclos de facturación cerrados) de tarjetas de crédito.

- Un estado de cuenta es el snapshot de un ciclo cerrado: `cycleStart` (cierre anterior, exclusive), `cycleEnd`, `dueDate` y `closingBalance`. Clave única `(cardId, currency, cycleEnd)`.
- `closingBalance` es la **deuda al cierre**, no el saldo de la tarjeta: `FinCardBalance.balance` es el crédito **disponible**, así que la deuda es `creditLimit - disponible` (misma regla que `creditBalanceSheet.creditCardDebt`). El cierre se deriva del disponible actual más los movimientos posteriores al cierre, por lo que es invariante mientras esos movimientos no cambien.
- `amountPaid`, `remaining` y `status` (`OPEN` | `CLOSED` | `PARTIAL` | `MINIMUM_PAID` | `PAID` | `OVERDUE`) se calculan en la lectura desde el ledger, no se confían al valor guardado. Un pago es un delta positivo del disponible (ingreso o transferencia recibida) dentro de `(cycleEnd, próximoCierre]`; para el ciclo más reciente la ventana llega hasta hoy.
- Un ciclo cuenta como cerrado solo cuando su día de cierre ya pasó, para no guardar un corte parcial.
- Sin `statementClosingDay` no hay estados; sin `creditLimit` la moneda se omite en lugar de inventar la deuda; sin `paymentDueDay`, `dueDate` queda nulo.
- Generación: tarea diaria que recorre las tarjetas `CREDIT` activas y hace upsert de todos los ciclos cerrados. La primera ejecución cubre el histórico; repetirla no duplica.
- Multi-moneda: un estado por moneda, cada uno con su propio disponible y su propio límite.
- Crédito disponible por moneda: `availableCredit = balance - pendientes`. `FinCardBalance.balance` ya es el disponible confirmado; los movimientos `PENDING` de la tarjeta (compras, pagos, reversas) se suman con su signo. Sin `creditLimit` no hay `availableCredit`.
- Próximo corte: `nextStatementDate` y `nextPaymentDueDate` en la respuesta de la tarjeta, con la regla de fin de mes del día de corte y la fecha local del usuario.
- Recordatorio de pago: el barrido diario `CardPaymentRemindersScheduler` llama a `CardPaymentRemindersService`, que emite `finance.card_payment.due` una sola vez por corte y fecha límite. Solo si el corte no está pagado y `dueDate` cae dentro de `reminders.cardDueDaysBefore` (default 3). No se emite si el corte está `PAID` ni si el evento ya está en el outbox.

`GET /finance/cards/:id/statements` devuelve `{ items, nextCursor, hasMore }` ordenado por `cycleEnd` descendente.

## Importar el estado de cuenta desde un PDF

`POST /finance/cards/:id/statements/import` (y `POST /finance/accounts/:id/statements/import`) recibe `multipart/form-data` con `file` (PDF, máx. 10 MB) y `password?`. Devuelve `{ importId }`.

- La petición abre el PDF para pedir la clave antes de crear nada: si el PDF tiene clave y falta o es incorrecta, responde 400 con código `STATEMENT_PASSWORD_REQUIRED`. La clave no se guarda.
- El parseo corre en la cola `statement-import` (`PARSING`). Sin BullMQ corre en la misma petición. Al terminar, `FinStatementImport.status` queda `READY` o `FAILED`.
- Texto con pdf.js (`PdfjsStatementTextExtractor`, token `STATEMENT_PDF_TEXT`) y extracción con LLM y esquema estricto (token `STATEMENT_EXTRACTOR`).
- La cabecera parseada (periodo, saldo anterior, saldo al corte, mínimo, fecha límite) vive en `parsed`; las filas en `FinStatementImportLine`. El archivo no se guarda.

`GET /finance/statement-imports/:id` devuelve estado, cabecera, líneas con la propuesta de match, movimientos que sobran y la diferencia de saldo. `PATCH .../lines/:lineId` cambia la decisión (`MATCH`, `CREATE`, `IGNORE`). `POST .../apply` crea las filas marcadas, cierra el corte de la tarjeta (`CLOSED`) y ajusta la diferencia si se pide; es idempotente. `DELETE .../:id` descarta el import.

El matcher es puro (`statement-line-matching.ts`): o misma referencia, o mismo monto y moneda con ±3 días y similitud de texto ≥ 0.8. Las filas sin match son «faltan en la app» y los movimientos del ciclo sin fila son «sobran en la app».

Evidencia: `statements/domain/statement-line-matching.spec.ts`, `statements/application/statement-imports.service.spec.ts`, `statements/infrastructure/pdfjs-statement-text.extractor.spec.ts` y el e2e `test/finance.e2e-spec.ts` (upload → apply). Fixtures sintéticos en `packages/finance/test/fixtures/bank-statements/`.

Evidencia: `statements/` (dominio + servicio + specs). Código: `packages/finance/src/statements/`.
