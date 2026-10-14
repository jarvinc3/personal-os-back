# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y [SemVer](https://semver.org/lang/es/). Reglas y ejemplo en [docs/reference/changelog-guide.md](./docs/reference/changelog-guide.md).

## [0.28.1] - 2026-10-19

### Cambiado

- Specs del registro y del ejecutor de tools que cubren `get_subscriptions_summary` y `get_subscription_alerts`.

## [0.28.0] - 2026-10-19

### Agregado

- `GET /finance/subscriptions/breakdown`: costo mensual en moneda base agrupado por categoría, tarjeta-cuenta o moneda.
- `GET /finance/subscriptions/upcoming`: cobros proyectados en una ventana de días o un rango, con todas las ocurrencias de los ciclos semanales.
- `GET /finance/subscriptions/alerts`: subida de precio, prueba por vencer, renovación anual y cobro sin registrar, con descarte persistido por tipo, suscripción y fecha.
- `GET /finance/subscriptions/summary` añade el costo del mes anterior, la tendencia, el gasto real del mes y del anterior, los detectados pendientes y el ahorro anual de las canceladas.
- Las suscripciones guardan categoría (`category_id`, FK a `fin_categories`) y la lista incrusta `paymentMethod` y `category`; filtros nuevos `categoryId`, `cardId` y `accountId`.
- Tools `get_subscriptions_summary` y `get_subscription_alerts`.
- Migración `fin_subscriptions_categories_alerts`: columna e índice de categoría y tabla de descartes de alertas.

## [0.27.2] - 2026-10-19

### Corregido

- La sugerencia de impuesto DGII usa solo las salidas en la moneda del producto, no las de todas las monedas de una tarjeta.
- El cargo DGII sugerido nunca supera la diferencia que explica.
- Conciliar una tarjeta de débito responde 404: su saldo se cierra desde la cuenta enlazada, y el estado del mes ya no lista esas tarjetas.
- La fecha de corte del cierre es opcional y por defecto es hoy.

### Cambiado

- El desglose mensual de cargos bancarios va en orden cronológico y `groupBy` devuelve solo el grupo pedido.
- Specs del filtro por moneda, del tope del DGII, de la fecha por defecto y del agrupado.

## [0.27.1] - 2026-10-19

### Cambiado

- Specs de las tools de conciliación: parámetros derivados del esquema de `reconcile_product`, ruteo del preview y de la confirmación con la sugerencia, lectura de `get_bank_charges` y rechazo de un `reconcile_product` sin exactamente un producto destino.

## [0.27.0] - 2026-10-19 - Conciliación

### Agregado

- Tablas `fin_reconciliations` y `fin_reconciliation_adjustments` con el enum de tipos de ajuste, las categorías de sistema de cada tipo y sus índices y llaves foráneas.
- REST `/finance/reconciliations`: `preview`, alta con sus ajustes en una transacción de BD, historial por producto, detalle, borrado del último cierre, `restore` y `status` del mes.
- `GET /finance/analytics/bank-charges`: total de cargos bancarios por mes, institución y tipo.
- Tools `reconcile_product` (vista previa y confirmación) y `get_bank_charges`.
- Los ajustes de conciliación mueven el saldo, no aparecen en el tablero ni en presupuestos, y se borran y restauran con el diario de borrados (`entityType` `reconciliation`).

## [0.26.1] - 2026-10-14

### Corregido

- `PATCH /finance/subscriptions/:id` con `status: ACTIVE` recalcula `nextBillingDate` desde hoy, igual que el endpoint `resume`.
- El emparejado de pagos compara días de calendario y no horas transcurridas: un cobro el día esperado a las 23:00 entra en la ventana de ±3 días.
- Registrar a mano un pago con un movimiento ya vinculado a la misma suscripción responde 409 en vez del error del índice único.
- Pausar, reanudar o cancelar limpia el sello del estado contrario (`pausedAt`/`cancelledAt`).
- Editar el dominio a `null` ya no rompe la actualización de la suscripción.

### Cambiado

- Specs del servicio de suscripciones (reanudar, emparejado de una sola candidata, pago manual duplicado) y del job de recordatorios (un evento por ciclo).

## [0.26.0] - 2026-10-14 - Suscripciones

### Agregado

- Tablas `fin_subscriptions` y `fin_subscription_payments` con enums de ciclo de facturación, estado y origen del pago, y sus índices y llaves foráneas.
- REST `/finance/subscriptions`: listado y alta, detalle y edición, `pause`, `resume`, `cancel`, `payments`, `logo` y `summary` (costo mensual y anual en la moneda base).
- Emparejado automático de pagos tras persistir o importar un movimiento, con el puerto `SUBSCRIPTION_MATCHER`, y job diario de recordatorios que emite `FINANCE_SUBSCRIPTION_RENEWAL_DUE`.
- Tools `create_subscription` y `confirm_subscription_payment`; `list_subscriptions` incluye las suscripciones gestionadas.

### Cambiado

- Suscripciones deja de ser un módulo: sale de `MODULE_SLUGS` y de `MODULE_CONTEXT`, su configuración vive en el bloque `subscriptions` de Finanzas y una migración borra sus filas de `modules` y `user_modules`.
- `PATCH /users/me/modules/:slug` responde 400 con un slug retirado como `subscriptions`.

## [0.25.2] - 2026-10-14

### Corregido

- El aviso de subida de precio de un recurrente confirmado vuelve a dispararse en cada ejecución: la detección usa una banda amplia solo para refrescar el patrón y deja intacta la tolerancia guardada que compara el último cobro.
- `GET /finance/recurring` pagina hacia delante con el cursor; la lista ordena por próximo cobro ascendente y antes repetía filas ya vistas.
- El gasto del mes de un comercio cubre el último día completo, y `GET /finance/merchants/:id` usa la ventana del mes en vez del histórico.
- Editar el nombre de un recurrente resuelve el comercio canónico, así que el cambio se ve en la lista y el detalle.
- `POST /finance/recurring` rechaza un alta sin comercio ni `merchantId`, y `nextExpectedDate` se valida como fecha ISO en alta y edición.

### Cambiado

- Se eliminan métodos de repositorio sin uso (`listTransactions` y `clearMerchantLinks` de comercios, `deletePatterns` de recurrentes). Sin cambios de comportamiento.
- Specs nuevos para el cursor del repositorio de recurrentes, el gasto del mes, la tolerancia del aviso de precio y la edición del comercio.

## [0.25.1] - 2026-10-14

### Cambiado

- La detección de recurrentes devuelve el aviso de subida de precio en vez de mutar la lista del llamador. Sin cambios de comportamiento.

## [0.25.0] - 2026-10-14 - Comercios y suscripciones detectadas

### Agregado

- Comercios canónicos: `FinMerchant` con clave normalizada y alias, `FinTransaction.merchantId` y el normalizador puro `normalize-merchant.ts` (gateway, referencias, estrella, ciudad y descriptores) con specs a partir de los correos BHD, Popular y Qik.
- REST de comercios: `GET /finance/merchants`, `GET /finance/merchants/:id`, `GET /finance/merchants/suggest`, `PATCH /finance/merchants/:id`, `POST /finance/merchants/:id/merge` y `POST /finance/merchants/:id/logo`.
- Recurrentes: `FinRecurringPattern` gana `merchantId`, `status`, `kind`, `lastSeenAt`, `amountTolerance`, `confirmedAt` y `createdAt`; detección pura por comercio, monto (±10 %) y periodicidad (7, 14, 30 o 365 días), con scheduler nocturno que respeta los descartados.
- REST de recurrentes: `GET /finance/recurring`, `GET /finance/recurring/upcoming`, `POST /finance/recurring` y `PATCH /finance/recurring/:id` (confirmar, descartar, editar).
- Eventos `finance.recurring.price_changed`, `finance.recurring.missed` y `finance.recurring.upcoming`, con su notificación en la app y el ajuste `recurringAlerts` de Finanzas.
- Tools `list_subscriptions`, `confirm_recurring` y `list_merchants`.
- La creación manual y la ingesta de correo resuelven y guardan el `merchantId`; `merchant` conserva el texto original.

### Cambiado

- `GET /finance/transactions` acepta el filtro `merchantId` y cada movimiento devuelve `merchantId`, `merchantName` y `merchantLogoUrl`.

## [0.24.4] - 2026-10-14

### Corregido

- El resumen semanal incluye todo el domingo: la consulta de gasto usa el último instante del último día de la semana en vez de su medianoche.

### Cambiado

- El spec del resumen semanal comprueba el límite del último día de la semana. Sin cambios de comportamiento.

## [0.24.3] - 2026-10-14

### Corregido

- La captura rápida rechaza una fecha imposible del modelo (por ejemplo `2026-02-31`) en el extractor, en vez de reemplazarla en silencio por la fecha de hoy. La validación vive en el borde que interpreta al modelo y el servicio confía en el contrato del puerto.

### Cambiado

- El spec del extractor de captura rápida cubre la fecha válida, la ausente y la imposible. Sin cambios de comportamiento aparte del rechazo.

## [0.24.2] - 2026-10-14

### Corregido

- La notificación del resumen semanal reporta la semana anterior completa, no la que acaba de empezar el mismo día del envío.
- `GET /api/finance/analytics/weekly-summary` responde 400 ante un `weekStart` que no es una fecha real (por ejemplo `2026-02-31`) en vez de fallar con un error interno.
- La captura rápida ignora una fecha imposible del modelo y usa la fecha de hoy.

### Cambiado

- Los specs cubren el día y la hora del envío semanal, la idempotencia por semana, los destinatarios según el ajuste, el texto de la notificación, la semana anterior y las fechas imposibles. Sin cambios de comportamiento.

## [0.24.1] - 2026-10-14

### Corregido

- El bloque de movimiento del chat ya no rellena tipo, monto, moneda, fecha ni estado que falten: un movimiento incompleto se omite en lugar de mostrar un valor inventado. La cuota del préstamo y el porcentaje del presupuesto se derivan solo de los datos presentes.

## [0.24.0] - 2026-10-14

### Agregado

- El chat del agente responde con bloques nativos de Finanzas: `transaction_card`, `transaction_list`, `budget_progress`, `loan_summary` y `chart`. El runner los arma desde las tools de lectura (el LLM no da forma a las cifras) y se guardan con el mensaje; los clientes viejos ignoran los tipos que no conocen.
- `POST /api/finance/quick-entry/parse` convierte una frase corta en un borrador de movimiento (tipo, monto, moneda, categoría, cuenta o tarjeta, fecha y comercio) con salida estructurada del LLM, resuelve alias contra el catálogo del usuario (por nombre, institución o últimos dígitos) y nunca guarda.
- `GET /api/finance/analytics/weekly-summary` devuelve el gasto de la semana frente al promedio de las cuatro anteriores, el top 3 de categorías, los presupuestos en riesgo, las próximas cuotas, los vencimientos de tarjeta y los correos pendientes.
- Un scheduler emite el resumen semanal por el outbox de notificaciones el día elegido, a las 08:00 de la zona del usuario, con idempotencia por semana.

### Cambiado

- La configuración de Finanzas suma `notifications.weeklySummary` (encendido por defecto) y `reports.weeklySummaryDay` (lunes por defecto).

## [0.23.2] - 2026-10-14

### Corregido

- El prompt de sistema acota el nombre y el resumen de la entidad en foco, para que una descripción de banco larga no infle el prompt.

### Cambiado

- El spec del contexto de entidad cubre todas las ramas de resolución (transferencia, cuenta, tarjeta, cuota, cobro, meta, institución, correo y vencimiento ausente). Sin cambios de comportamiento.
- El spec del repositorio de catálogo pasa el diario de eliminación que exige el constructor. Sin cambios de comportamiento.

## [0.23.1] - 2026-10-14

### Cambiado

- Leer y guardar el contexto de la sesión son operaciones separadas. Sin cambios de comportamiento.

## [0.23.0] - 2026-10-14

### Agregado

- `POST /api/ai/chat`, `POST /api/ai/chat/stream` y `POST /api/ai/sessions` aceptan `context` (`ChatContext`: `moduleSlug`, `screen?`, `entityRef?: { type, id }`).
- El agente resuelve la entidad en foco con la fachada de Finanzas (dueño validado por `userId`) y suma tipo, nombre, saldo/estado e id al prompt de sistema. La sesión guarda el último `context` (`ai_agent_sessions.chat_context`).

## [0.22.2] - 2026-10-14

### Corregido

- Un cursor paginado con forma válida pero con una fecha inválida responde 400 en vez de fallar en la consulta.

### Cambiado

- `GET /api/finance/budgets` desempaca el cursor con el helper compartido, igual que el resto de las listas. Sin cambios de comportamiento.

## [0.22.1] - 2026-10-14

### Cambiado

- Los repositorios de planificación, correo y papelera comparten un helper para desempacar el cursor. Sin cambios de comportamiento.

## [0.22.0] - 2026-10-14

### Agregado

- `GET /api/finance/loans/:id/installments`, `GET /api/finance/receivables/:id/payments`, `GET /api/finance/savings-goals/:id/allocations` (y su alias `/contributions`), `GET /api/finance/email-sync/pending` y `GET /api/finance/email-sync/messages` aceptan `cursor` + `limit` (1-100, por defecto 20) y devuelven `{ items, nextCursor, hasMore }`.
- Los eliminados de `GET /api/finance/recycle-bin` paginan por fecha dentro de `{ archived, items, nextCursor, hasMore }`.

### Cambiado

- `GET /api/finance/recycle-bin` deja de devolver `{ archived, deleted }`: los archivados van completos en `archived` y los borrados paginan en `items`.
- La tool `list_pending_emails` pide la primera página y devuelve `hasMore`.

## [0.21.1] - 2026-10-14

### Corregido

- Subir un PDF dañado responde 400 con `STATEMENT_PARSE_FAILED` en vez de un error 500.
- Ignorar una línea ya emparejada y volver a marcarla conserva su movimiento; antes se creaba un duplicado.
- Aplicar un import de tarjeta registra el corte cerrado en el historial del instrumento, igual que el cierre manual.
- Si el worker no puede leer el PDF temporal, el import queda `FAILED` en vez de quedarse en `PARSING`.

## [0.21.0] - 2026-10-14

### Agregado

- Importar un estado de cuenta desde un PDF: `POST /api/finance/cards/:id/statements/import` y `POST /api/finance/accounts/:id/statements/import` crean el import y lo parsean en la cola `statement-import` (o en la misma petición si BullMQ no está disponible). La clave del PDF se pide y no se guarda; el archivo tampoco.
- Conciliación de un import: `GET`/`DELETE /api/finance/statement-imports/:id`, `PATCH .../lines/:lineId` y `POST .../apply`. El matcher empareja por referencia o por monto, moneda, ±3 días y texto parecido. Aplicar crea los movimientos marcados, cierra el corte de la tarjeta y ajusta la diferencia si se pide; es idempotente.
- Modelos `FinStatementImport` y `FinStatementImportLine` (migración `20261015230000_fin_statement_imports`).

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
