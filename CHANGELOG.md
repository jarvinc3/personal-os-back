# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y [SemVer](https://semver.org/lang/es/). Reglas y ejemplo en [docs/reference/changelog-guide.md](./docs/reference/changelog-guide.md).

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
