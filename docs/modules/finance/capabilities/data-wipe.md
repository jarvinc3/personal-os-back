# Capacidad: vaciado de datos de Finanzas

Las ramas de datos de Finanzas viven en `shared/domain/finance-data-branches.ts` y las aplica `WipeFinanceUserDataUseCase`. El orquestador de `users` las consulta, expande lo que arrastran y las ejecuta **en una sola transacción** por app: un fallo en cualquier paso revierte todo el vaciado de Finanzas.

Cada rama cuenta y borra con la misma definición (`countBranches` / `wipeBranches`), así que el conteo que el usuario confirma es el que se borra. Pedir una rama que ya está vacía responde 0 y no cambia nada.

## Ramas del núcleo

| Rama                      | Qué borra o restablece                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance.reconciliations` | Conciliaciones con sus ajustes y descuadres detectados. Los movimientos de ajuste se conservan.                                                                                                                                                                                                                                                                             |
| `finance.transactions`    | Movimientos y trazas de importación por señal; arrastra conciliaciones (FK). Deja las cuentas en 0, el disponible de las tarjetas de crédito en su límite y el gastado de los presupuestos en 0. No borra comercios, recurrentes ni bitácora.                                                                                                                               |
| `finance.balances`        | Restablece (no borra) cuentas a 0 y tarjetas de crédito a su límite; se puede limitar a una institución (`balanceInstitutionId`).                                                                                                                                                                                                                                           |
| `finance.statements`      | Estados de cuenta de tarjetas con sus importaciones y las importaciones sin cuenta; las facturadas a una cuenta van con «Cuentas». Las tarjetas siguen existiendo.                                                                                                                                                                                                          |
| `finance.loans`           | Préstamos con sus cuotas y pagos anticipados.                                                                                                                                                                                                                                                                                                                               |
| `finance.cards`           | Tarjetas de crédito con sus saldos; arrastra sus movimientos, conciliaciones, descuadres y estados de cuenta, que se ejecutan antes. Las suscripciones quedan sin tarjeta. Las cuentas, las instituciones y las tarjetas de débito siguen existiendo.                                                                                                                       |
| `finance.debitCards`      | Tarjetas de débito con sus saldos. Se borran con su cuenta, que las arrastra; las tarjetas de crédito y las cuentas siguen existiendo.                                                                                                                                                                                                                                      |
| `finance.accountImports`  | Importaciones de estados de cuenta facturadas a una cuenta. Se borran con su cuenta, que las arrastra; las de tarjetas y las tarjetas siguen existiendo.                                                                                                                                                                                                                    |
| `finance.accounts`        | Cuentas, incluido el efectivo, con sus movimientos, sus conciliaciones y descuadres, los préstamos de esas cuentas, las tarjetas de débito vinculadas y las importaciones de estados de cuenta facturadas a ellas, que se ejecutan antes y la confirmación lista con su conteo. Metas, cobros y suscripciones quedan sin cuenta. Las tarjetas de crédito siguen existiendo. |
| `finance.institutions`    | Instituciones que no son de sistema (se conserva «Efectivo»); arrastra sus cuentas, tarjetas de crédito, tarjetas de débito y préstamos, que se ejecutan antes y la confirmación lista con su conteo. Los logos propios se borran del almacenamiento después de confirmar la transacción.                                                                                   |

Orden de ejecución: conciliaciones → movimientos → saldos → estados de cuenta → préstamos → tarjetas de crédito → tarjetas de débito → importaciones de cuentas → cuentas → instituciones.

## Ramas de planificación y catálogo

| Rama                    | Qué borra                                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance.subscriptions` | Suscripciones con sus pagos y alertas descartadas. Los movimientos siguen existiendo.                                                                    |
| `finance.recurring`     | Patrones recurrentes detectados; las suscripciones conservan sus datos.                                                                                  |
| `finance.merchants`     | Comercios con sus alias y pares descartados. Movimientos y recurrentes conservan el texto, sin comercio.                                                 |
| `finance.savingsGoals`  | Metas con sus aportes.                                                                                                                                   |
| `finance.receivables`   | Cobros con sus compartidos y pagos.                                                                                                                      |
| `finance.budgets`       | Presupuestos con sus categorías y alertas.                                                                                                               |
| `finance.categories`    | Categorías propias (las del sistema se conservan); arrastra `finance.budgets`. Movimientos, comercios, suscripciones y recurrentes quedan sin categoría. |

Orden completo: conciliaciones → movimientos → saldos → estados de cuenta → préstamos → tarjetas de crédito → tarjetas de débito → importaciones de cuentas → cuentas → instituciones → suscripciones → recurrentes → comercios → metas → cobros → presupuestos → categorías.

Las ramas de esta segunda mitad nunca tocan movimientos, cuentas, tarjetas ni instituciones: solo borran sus filas y desvinculan lo que apuntaba a ellas. Un fallo en cualquier paso revierte todo el vaciado de Finanzas.

## Reglas

- Vaciar «Movimientos» nunca borra productos ni planificación.
- Lo que una rama arrastra se declara en `includes` y se ejecuta antes que ella, para que la confirmación y los conteos del vaciado coincidan.
- Vaciar «Cuentas» o «Tarjetas» no borra la institución.
- Vaciar «Tarjetas» borra solo crédito; las de débito se borran con su cuenta y la confirmación de «Cuentas» las lista.
- Las importaciones de estados de cuenta siguen a su dueño: las facturadas a una cuenta van con «Cuentas», que las arrastra y las lista con su conteo, y el resto queda con «Estados de cuenta». Ninguna importación cae sin aviso.
- «Efectivo» nunca se borra; sus cuentas se pueden vaciar y se vuelven a crear al usarlas, una sola vez aunque dos lecturas lleguen a la vez.
- Vaciar una rama no toca movimientos, cuentas, tarjetas ni instituciones salvo lo indicado; solo desvincula las referencias.
- Los archivos propios (logos de institución y de comercio) se borran solo después de que la transacción confirma, para no dejar huérfanos ni borrar lo que sobrevive al fallo. Los de comercio se recogen cuando la rama pedida es `finance.merchants`.

Evidencia: `shared/application/wipe-finance-user-data.use-case.ts`, `shared/domain/finance-data-branches.ts` y su spec.
