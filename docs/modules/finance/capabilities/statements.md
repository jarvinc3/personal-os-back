# Capacidad: statements

Estados de cuenta (ciclos de facturación cerrados) de tarjetas de crédito.

- Un estado de cuenta es el snapshot de un ciclo cerrado: `cycleStart` (cierre anterior, exclusive), `cycleEnd`, `dueDate` y `closingBalance`. Clave única `(cardId, currency, cycleEnd)`.
- `closingBalance` es la **deuda al cierre**, no el saldo de la tarjeta: `FinCardBalance.balance` es el crédito **disponible**, así que la deuda es `creditLimit - disponible` (misma regla que `creditBalanceSheet.creditCardDebt`). El cierre se deriva del disponible actual más los movimientos posteriores al cierre, por lo que es invariante mientras esos movimientos no cambien.
- `amountPaid`, `remaining` y `status` (`OPEN` | `CLOSED` | `PARTIAL` | `MINIMUM_PAID` | `PAID` | `OVERDUE`) se calculan en la lectura desde el ledger, no se confían al valor guardado. Un pago es un delta positivo del disponible (ingreso o transferencia recibida) dentro de `(cycleEnd, próximoCierre]`; para el ciclo más reciente la ventana llega hasta hoy.
- Un ciclo cuenta como cerrado solo cuando su día de cierre ya pasó, para no guardar un corte parcial.
- Sin `statementClosingDay` no hay estados; sin `creditLimit` la moneda se omite en lugar de inventar la deuda; sin `paymentDueDay`, `dueDate` queda nulo.
- Generación: tarea diaria que recorre las tarjetas `CREDIT` activas y hace upsert de todos los ciclos cerrados. La primera ejecución cubre el histórico; repetirla no duplica.
- Multi-moneda: un estado por moneda, cada uno con su propio disponible y su propio límite.

`GET /finance/cards/:id/statements` devuelve el array ordenado por `cycleEnd` descendente.

Evidencia: `statements/` (dominio + servicio + specs). Código: `packages/finance/src/statements/`.
