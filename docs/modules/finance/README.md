# Finance

| Documento                                                          | Contenido                                      |
| ------------------------------------------------------------------ | ---------------------------------------------- |
| [overview.md](./overview.md)                                       | Propósito, arquitectura, consumidores          |
| [capabilities/catalog.md](./capabilities/catalog.md)               | Instituciones, cuentas, tarjetas, categorías   |
| [capabilities/statements.md](./capabilities/statements.md)         | Estados de cuenta de tarjetas de crédito       |
| [capabilities/ledger.md](./capabilities/ledger.md)                 | Transacciones, transfers, confirm, reverse     |
| [capabilities/planning.md](./capabilities/planning.md)             | Budgets, savings, loans, receivables           |
| [capabilities/analytics.md](./capabilities/analytics.md)           | Summary, spending, budget-status, bank-charges |
| [capabilities/intelligence.md](./capabilities/intelligence.md)     | Capacidad mensual de lectura AI-9              |
| [capabilities/reconciliation.md](./capabilities/reconciliation.md) | Cierre de cuenta o tarjeta contra el banco     |
| [capabilities/integrity.md](./capabilities/integrity.md)           | Saldo vs. movimientos (invariante I1)          |
| [capabilities/balance-sheet.md](./capabilities/balance-sheet.md)   | Snapshot `BASE_CURRENCY`                       |
| [capabilities/entities.md](./capabilities/entities.md)             | Consulta de entidades en lote por referencia   |
| [capabilities/merchants.md](./capabilities/merchants.md)           | Comercios, alias, categoría y logo             |
| [capabilities/data-wipe.md](./capabilities/data-wipe.md)           | Ramas del vaciado de datos de Finanzas         |
| [capabilities/ingestion.md](./capabilities/ingestion.md)           | Gmail OAuth, sources, pending assign           |
| [capabilities/fx.md](./capabilities/fx.md)                         | Tasas históricas                               |
| [capabilities/events.md](./capabilities/events.md)                 | Outbox                                         |
| [rules/ledger.md](./rules/ledger.md)                               | Invariantes de saldo y XOR                     |
| [contracts/http.md](./contracts/http.md)                           | REST                                           |
| [contracts/rest-vs-facade.md](./contracts/rest-vs-facade.md)       | Subconjunto AI                                 |
| [contracts/finance-tools.md](./contracts/finance-tools.md)         | Tools `moduleSlug=finance`                     |
| [contracts/boundaries.md](./contracts/boundaries.md)               | Eventos y adaptadores por frontera             |
| [operations/gmail-sync.md](./operations/gmail-sync.md)             | Pipeline sync                                  |

UI: `personal-os-web/docs/modules/finance/`. Código: `packages/finance/src/`.

Estado y trabajo pendiente: GitHub Issues del repo (label `roadmap`).
