# Capacidad: catalog

Instituciones, cuentas, tarjetas, categorías.

- Cuentas: tipos `CHECKING` `SAVINGS` `CASH` `INVESTMENT`. **No** son tarjetas; `lastFour` vive en `FinCard`. Alta **sin** campo `balance` (el saldo lo mueve el ledger).
- Número de cuenta: se guarda cifrado (AES-256-GCM con `DATA_ENCRYPTION_KEY`). Las respuestas exponen `accountNumberLast4` y **nunca** el número completo; el alta y la edición siguen recibiendo `accountNumber` en claro. Un `accountNumberHash` (HMAC-SHA256) conserva la unicidad por institución sin descifrar. En edición, omitir `accountNumber` conserva el guardado; enviarlo lo recifra.
- Soft-delete cuenta: `PATCH isActive: false`. El borrado duro de la cuenta de efectivo de la moneda base responde 400 (se desactiva).
- Efectivo: institución de sistema (`type: cash`, `isSystem`), una por usuario; no se edita, archiva ni borra, y `PATCH type: 'cash'` sobre otra institución responde 400. Las cuentas `CASH` viven dentro de ella, una por moneda.
- Tarjetas: CREDIT/DEBIT; balances `POST /cards/:id/balances`. En CREDIT, `balance` es **disponible**; `creditLimit` obligatorio en UI web y se guarda por moneda en `fin_card_balances.credit_limit` (no hay tabla aparte).
- `GET /cards` y `GET /cards/:id` añaden por moneda `availableCredit` (disponible menos movimientos pendientes) y, a nivel de tarjeta, `nextStatementDate` y `nextPaymentDueDate` calculados con la fecha local del usuario.
- Categorías: system + custom; `type` `EXPENSE` | `INCOME` (default `EXPENSE`). `PATCH` puede cambiar `type` solo si la categoría queda sin padre; si tiene hijas, el mismo update les copia el tipo. Con padre, cambiar `type` responde 400. `parentId: null` desvincula. Jerarquía acíclica y del mismo tipo. `GET ?type=` opcional; DELETE system → 404. Seed de sistema en la migración `add_fin_category_type`. Las hijas de sistema reciben color propio en `system_child_category_colors`; si una hija queda sin color, hereda el del padre.
- Listas: arrays no paginados (escala personal).

Ownership: [rules/ledger.md](../rules/ledger.md) BR-FIN-005–007.

Borrado en cascada (migraciones `finance_cascade_institution_category` y `fin_loans_account_cascade`): borrar una institución arrastra cuentas, tarjetas, préstamos y movimientos; borrar un padre de categoría arrastra hijas y presupuestos; borrar una cuenta arrastra movimientos y préstamos; borrar una tarjeta arrastra movimientos. El vaciado por ramas se apoya en esto: `finance.institutions` borra las instituciones que no son de sistema sin recorrer hijos, y `finance.accounts`, `finance.cards` (crédito) y `finance.debitCards` borran las suyas. La institución Efectivo se conserva y `ensureCashInstitution` repone su cuenta base cuando falta.

Evidencia: `catalog/` services + specs.
