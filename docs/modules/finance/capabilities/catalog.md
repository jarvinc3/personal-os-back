# Capacidad: catalog

Instituciones, cuentas, tarjetas, categorías.

- Cuentas: tipos `CHECKING` `SAVINGS` `CASH` `INVESTMENT`. **No** son tarjetas; `lastFour` vive en `FinCard`. Alta **sin** campo `balance` (el saldo lo mueve el ledger).
- Soft-delete cuenta: `PATCH isActive: false`. No hay `DELETE /accounts`.
- Tarjetas: CREDIT/DEBIT; balances `POST /cards/:id/balances`. En CREDIT, `balance` es **disponible**; `creditLimit` obligatorio en UI web.
- Categorías: system + custom; jerarquía `parentId` acíclica; DELETE system → 404.
- Listas: arrays no paginados (escala personal).

Ownership: [rules/ledger.md](../rules/ledger.md) BR-FIN-005–007.

Evidencia: `catalog/` services + specs.
