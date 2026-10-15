# Context: personal-os-back

Glosario del dominio de Personal OS. Solo entran términos con significado de negocio; la
infraestructura (paquetes Nest, colas, Prisma) queda fuera.

## Lenguaje

**Module** (módulo de producto):
De cara al usuario se llama **App** ([docs/glosario.md](./docs/glosario.md)); el código mantiene `module`.
Capacidad que un usuario activa o desactiva en su cuenta (finance, agenda, projects, health).
Su estado y configuración viven por usuario; no es un paquete Nest. Suscripciones no es un
módulo: es parte de Finanzas.
_Avoid_: "Nest module" para esta idea; eso es la estructura de código en `packages/*`.

**Institution** (institución):
Banco, cooperativa, billetera digital, bróker o efectivo que el usuario registra. Agrupa sus
cuentas y tarjetas y es la etiqueta detrás de la importación de correos.

**Account** (cuenta):
Lugar donde el usuario guarda dinero (cheques, ahorro, efectivo, inversión). Un movimiento
toca exactamente una cuenta o una tarjeta, nunca ambas.
_Avoid_: "cuenta" para un buzón de correo; eso es una Email connection.

**Card** (tarjeta):
Tarjeta de crédito o débito ligada a una institución. La de débito descuenta de una cuenta;
la de crédito lleva su propio saldo por moneda.

**Card balance**:
En una tarjeta de crédito, el saldo guardado es el crédito disponible, no la deuda. La deuda
es el límite menos el disponible, y de ahí sale el cierre del estado de cuenta.
_Avoid_: "balance de la tarjeta" para la deuda.

**Ledger target** (destino de ledger):
La cuenta o la tarjeta a la que un movimiento aplica su saldo. Son excluyentes entre sí.

**Transaction** (movimiento):
Un evento de dinero registrado. Guarda el monto original en su moneda de origen, el monto
aplicado al saldo del destino y el monto convertido a la moneda base para analítica.
_Avoid_: "operación" para una sola fila.

**Base currency** (moneda base):
La moneda con la que se totaliza para un usuario. Se toma de la configuración del módulo
finance (`baseCurrency`); `BASE_CURRENCY` del entorno es solo el respaldo.

**Confirmed**:
Estado del movimiento que aplica saldo y presupuesto. No existe "completado".
_Avoid_: completed, completado.

**Transfer** (transferencia):
Operación que mueve dinero entre dos cuentas del propio usuario, con una comisión opcional.
Las filas comparten grupo y cada una lleva un rol (origen, destino, comisión): la
transferencia es el grupo, no una fila. El filtro `type=TRANSFER` apunta a la pata de origen.

**Operation leg** (pata):
Una fila dentro de una operación de varias patas (transferencia, comisión). Lleva su rol
(`SOURCE`, `DESTINATION`, `FEE`) y comparte el grupo de transferencia con las demás.

**Category** (categoría):
Etiqueta para clasificar movimientos, de gasto o de ingreso, opcionalmente bajo un padre.
Las de sistema vienen con la app; las personalizadas son del usuario.

**Budget** (presupuesto):
Límite de gasto para una categoría en un periodo, con acumulado, arrastre opcional y umbral
de aviso.

**Savings goal** (meta de ahorro):
Monto que el usuario aparta hacia un objetivo. En modo `EARMARK` el dinero queda reservado
dentro de su cuenta; en `DEDICATED` se compromete a una cuenta propia de la meta.

**Savings goal contribution** (aporte):
Uno de los montos apartados para una meta, opcionalmente ligado al movimiento que lo
financió. El saldo de la meta es la suma de sus aportes.

**Loan** (préstamo):
Dinero que el usuario debe, con cronograma de cuotas, tasa y tipo de tasa. Puede ligarse a
una institución y a una cuenta de pago.

**Loan installment** (cuota):
Pago programado de un préstamo, con vencimiento y monto desglosado en capital, intereses,
seguro y cargos. Se marca como pagada al cubrirse.

**Loan prepayment** (prepago):
Pago anticipado contra un préstamo, con penalidad opcional y un modo que decide cómo se
recalcula el saldo.

**Receivable** (cobro):
Dinero que le deben al usuario, con deudor y un monto pagado. Admite sobrepago (queda como
crédito a favor) y castigo por incobrable; su estado es `PENDING`, `PARTIAL`, `PAID`,
`CANCELLED` o `WRITTEN_OFF`.

**Receivable payment** (cobro recibido):
Una entrada de dinero contra un cobro, con el movimiento que la registró para poder revertir
ambos lados juntos.

**Statement** (estado de cuenta):
Ciclo de facturación cerrado de una tarjeta de crédito: deuda al cierre, fechas del ciclo y
de pago, y pago mínimo. El monto pagado y el estado se calculan desde el ledger en cada
lectura.
_Avoid_: tratarlo como un saldo de la tarjeta.

**Card statement status**:
Estado derivado de un estado de cuenta: `OPEN`, `CLOSED`, `PARTIAL`, `MINIMUM_PAID`, `PAID`,
`OVERDUE`. Se calcula con los pagos del ciclo; no es un hecho guardado.

**Recurring pattern** (patrón recurrente):
Comerciante, monto y frecuencia detectados en movimientos pasados para predecir el próximo
cargo. Está reservado en el esquema y todavía no tiene API.
_Avoid_: usar "recurrente" para `Budget.recurring` o `Transaction.isRecurring` sin aclarar
que son banderas distintas.

**Instrument** (instrumento):
Una cuenta o una tarjeta vista como un único objeto con historial (cambios de límite,
ajustes, cierres). Agrupa lo que comparten ambas.

**Email connection** (buzón):
Correo autorizado (Gmail o IMAP) del que se leen las notificaciones bancarias; uno por
proveedor y dirección.

**Email source** (fuente):
Vínculo entre un buzón y una institución, filtrado por los remitentes del banco. No es un
destino de ledger.

**Email message** (correo procesado):
Un correo bancario procesado, con su resultado de extracción y, si aplica, el movimiento que
produjo. Su resultado es la cola de revisión (`IMPORTED`, `PENDING_ASSIGNMENT`,
`PENDING_AMOUNT`, `SKIPPED_*`, `FAILED_*`).

**Domain event** (evento de dominio):
Hecho del negocio guardado en la misma transacción que el cambio y publicado después del
commit. El outbox garantiza que los efectos secundarios no dependan del request.

**Deletion journal** (diario de borrado):
Registro de deshacer para una entidad de finanzas borrada: una foto de sus filas y los
deltas de ledger revertidos, disponible hasta que expira.

**AI session**:
Conversación con el asistente, acotada a un contexto de módulo que decide qué herramientas
tiene disponibles.

**AI action** (acción):
Llamada de herramienta que muta datos y que el usuario confirma o cancela antes de
ejecutarse (`PENDING`, `RUNNING`, `SUCCESS`, `FAILED`, `CANCELLED`).

**Notification** (notificación):
Aviso al usuario por un canal (`IN_APP`, `PUSH`, `EMAIL`), guardado antes de entregarse.
