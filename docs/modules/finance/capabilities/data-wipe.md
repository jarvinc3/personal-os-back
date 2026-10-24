# Capacidad: vaciado de datos de Finanzas

Las ramas de datos de Finanzas viven en `shared/domain/finance-data-branches.ts` y las aplica `WipeFinanceUserDataUseCase`. El orquestador de `users` las consulta, expande lo que arrastran y las ejecuta **en una sola transacción** por app: un fallo en cualquier paso revierte todo el vaciado de Finanzas.

Cada rama cuenta y borra con la misma definición (`countBranches` / `wipeBranches`), así que el conteo que el usuario confirma es el que se borra. Pedir una rama que ya está vacía responde 0 y no cambia nada.

## Ramas del núcleo

| Rama                      | Qué borra o restablece                                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance.reconciliations` | Conciliaciones con sus ajustes y descuadres detectados. Los movimientos de ajuste se conservan.                                                                                                                                                                                       |
| `finance.transactions`    | Movimientos; arrastra conciliaciones (FK). Deja las cuentas en 0, el disponible de las tarjetas de crédito en su límite y el gastado de los presupuestos en 0. No borra comercios, recurrentes, correos ni bitácora.                                                                  |
| `finance.balances`        | Restablece (no borra) cuentas a 0 y tarjetas de crédito a su límite; se puede limitar a una institución (`balanceInstitutionId`).                                                                                                                                                     |
| `finance.cards`           | Tarjetas con sus saldos; arrastra sus movimientos, conciliaciones, descuadres y estados de cuenta. Las suscripciones quedan sin tarjeta. Las cuentas y las instituciones siguen existiendo.                                                                                           |
| `finance.accounts`        | Cuentas, incluido el efectivo, con sus movimientos y los préstamos de esas cuentas. Metas, cobros y suscripciones quedan sin cuenta. Las tarjetas siguen existiendo.                                                                                                                  |
| `finance.institutions`    | Instituciones que no son de sistema (se conserva «Efectivo»), sus cuentas y tarjetas por cascada, los préstamos vinculados y las fuentes de correo (con sus tareas de sincronización canceladas). Los logos propios se borran del almacenamiento después de confirmar la transacción. |

Orden de ejecución: conciliaciones → movimientos → saldos → tarjetas → cuentas → instituciones.

## Reglas

- Vaciar «Movimientos» nunca borra productos ni planificación.
- Vaciar «Cuentas» o «Tarjetas» no borra la institución.
- «Efectivo» nunca se borra; sus cuentas se pueden vaciar y se vuelven a crear al usarlas.
- Los archivos propios (logos de institución y de comercio) se borran solo después de que la transacción confirma, para no dejar huérfanos ni borrar lo que sobrevive al fallo.

Evidencia: `shared/application/wipe-finance-user-data.use-case.ts`, `shared/domain/finance-data-branches.ts` y su spec.
