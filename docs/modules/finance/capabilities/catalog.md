# Capacidad: catalog

Instituciones, cuentas, tarjetas, categorías.

- Cuentas: tipos `CHECKING` `SAVINGS` `CASH` `INVESTMENT`. **No** son tarjetas; `lastFour` vive en `FinCard`. Alta **sin** campo `balance` (el saldo lo mueve el ledger).
- Soft-delete cuenta: `PATCH isActive: false`. No hay `DELETE /accounts`.
- Tarjetas: CREDIT/DEBIT; balances `POST /cards/:id/balances`. En CREDIT, `balance` es **disponible**; `creditLimit` obligatorio en UI web y se guarda por moneda en `fin_card_balances.credit_limit` (no hay tabla aparte).
- `GET /cards` y `GET /cards/:id` añaden por moneda `availableCredit` (disponible menos movimientos pendientes) y, a nivel de tarjeta, `nextStatementDate` y `nextPaymentDueDate` calculados con la fecha local del usuario.
- Categorías: system + custom; `type` `EXPENSE` | `INCOME` (default `EXPENSE`). `PATCH` puede cambiar `type` solo si la categoría queda sin padre; si tiene hijas, el mismo update les copia el tipo. Con padre, cambiar `type` responde 400. `parentId: null` desvincula. Jerarquía acíclica y del mismo tipo. `GET ?type=` opcional; DELETE system → 404. Seed de sistema en la migración `add_fin_category_type`. Las hijas de sistema reciben color propio en `system_child_category_colors`; si una hija queda sin color, hereda el del padre.
- Listas: arrays no paginados (escala personal).

Ownership: [rules/ledger.md](../rules/ledger.md) BR-FIN-005–007.

Borrado en cascada (migraciones `finance_cascade_institution_category` y `fin_loans_account_cascade`): borrar una institución arrastra cuentas, tarjetas, préstamos, sources de Gmail y movimientos; borrar un padre de categoría arrastra hijas y presupuestos; borrar una cuenta arrastra movimientos y préstamos; borrar una tarjeta arrastra movimientos. El wipe por capas se apoya en esto: `finance.catalog` borra instituciones y cuentas sin recorrer hijos.

Evidencia: `catalog/` services + specs.
