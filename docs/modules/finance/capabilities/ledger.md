# Capacidad: ledger

Campos de importe: `amount`/`currency` original; `ledgerAmount`/`ledgerCurrency` aplicado al saldo; `amountBaseCurrency`/`exchangeRate` para analytics. `amountBaseCurrency` usa la **moneda base del usuario** (`user_modules.config.baseCurrency`); el env `BASE_CURRENCY` es solo fallback. Si la moneda del comando falta, se asume esa base.

El detalle de un movimiento expone `planningLink { kind, targetId, label }` cuando está ligado a una cuota de préstamo, un cobro o una meta; el listado no carga esa relación.

Moneda del ledger en el destino: una cuenta aplica su propia moneda; una tarjeta de débito aplica la de su cuenta. Una tarjeta de crédito aplica la moneda del movimiento solo si la declara en sus balances; si declara una sola, convierte a esa con la tasa del día y guarda monto original y tasa. Con varias monedas y ninguna coincidente responde 400 `CARD_CURRENCY_UNDECLARED`. Agregar la moneda al producto deja de ser obligatorio.

`GET /api/finance/transactions` paginado `{ items, pagination }` default page=1 limit=20 max 100. Filtros: fechas, cuenta, tarjeta, categoría, tipo, status, search, `transferGroupId`.

Importación por correo: la transferencia de una pata está implementada y probada (PR #340, `6c15b2f`): resuelve la cuenta propia por `accountNumberLast4`, crea una sola fila con `transferGroupId` y `legRole`, y distingue duplicado, contraparte legítima y conflicto de referencia. El emparejamiento de la segunda pata, los pagos de tarjeta, la fecha sugerida y los reversos siguen pendientes del contrato en [contracts/email-import.md](../contracts/email-import.md) y de los issues [#334](https://github.com/jarvinc3/personal-os-back/issues/334), [#335](https://github.com/jarvinc3/personal-os-back/issues/335), [#337](https://github.com/jarvinc3/personal-os-back/issues/337) y [#336](https://github.com/jarvinc3/personal-os-back/issues/336). El clasificador ya acepta estas pistas y su prompt las pide: `accountNumberLast4`, `CARD_PAYMENT`, `suggestedTransactionDate` con procedencia y `reverseOfEmailMessageId`.

Writes: create DEBIT/CREDIT, PATCH metadata/update, confirm, reverse, DELETE, `POST /transfers` y `PATCH /transfers/:id` (editar una transferencia reajusta las dos patas del par). La pata destino acepta `exchangeRate` o `receivedAmount`; sin ellos usa la tasa del día y queda `isEstimated`. `POST /transfers/:id/reverse` reversa todas las patas de una operación completada. Los pagos de tarjeta se listan como operaciones `TRANSFER`.

**AC-FIN-001:** Given cuenta DOP y DEBIT USD CONFIRMED, When create, Then `ledgerAmount` ≠ raw amount si hay FX del día.

**AC-FIN-002:** Given PENDING, When confirm, Then CONFIRMED y saldo movido.

**AC-FIN-003:** Given tarjeta CREDIT con balance solo en DOP y compra DEBIT en USD, When create, Then `ledgerCurrency` es DOP, `exchangeRate` guarda la tasa y no aparece un balance en USD.

Evidencia: `ledger/application/*use-case.ts` y specs.
