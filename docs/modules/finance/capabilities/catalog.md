# Capacidad: catalog

Instituciones, cuentas, tarjetas, categorías.

- Cuentas: tipos `CHECKING` `SAVINGS` `CASH` `INVESTMENT`. **No** son tarjetas; `lastFour` vive en `FinCard`. Alta **sin** campo `balance` (el saldo lo mueve el ledger).
- Soft-delete cuenta: `PATCH isActive: false`. No hay `DELETE /accounts`.
- Tarjetas: CREDIT/DEBIT; balances `POST /cards/:id/balances`. En CREDIT, `balance` es **disponible**; `creditLimit` obligatorio en UI web.
- Categorías: system + custom; `type` `EXPENSE` | `INCOME` (default `EXPENSE`). `PATCH` puede cambiar `type` solo si la categoría queda sin padre; si tiene hijas, el mismo update les copia el tipo. Con padre, cambiar `type` responde 400. `parentId: null` desvincula. Jerarquía acíclica y del mismo tipo. `GET ?type=` opcional; DELETE system → 404. Seed de sistema en la migración `add_fin_category_type`. Las hijas de sistema reciben color propio en `system_child_category_colors`; si una hija queda sin color, hereda el del padre.
- Listas: arrays no paginados (escala personal).

Ownership: [rules/ledger.md](../rules/ledger.md) BR-FIN-005–007.

Evidencia: `catalog/` services + specs.
