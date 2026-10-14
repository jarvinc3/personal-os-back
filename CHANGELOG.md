# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y [SemVer](https://semver.org/lang/es/). Reglas y ejemplo en [docs/reference/changelog-guide.md](./docs/reference/changelog-guide.md).

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
