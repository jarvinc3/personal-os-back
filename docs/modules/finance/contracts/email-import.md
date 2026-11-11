# Importación por correo: transferencias, pagos, datos faltantes y reversos

- Estado: contrato acordado. La transferencia de una pata (#340), el pago de tarjeta (#335), las pistas del clasificador (#343) y la vista previa de muestra (#342) están implementados en develop. Esta unidad implementa los reversos; el consumidor de fecha sugerida de #337 sigue pendiente.
- Fecha: 2026-11-11. Decisiones del owner del 2026-11-11 incorporadas en la sección 0.
- Base integrada: `develop` `ed7221c1684fede4f634d0624191c1228bb6ffe9`.
- Issues: [#334](https://github.com/jarvinc3/personal-os-back/issues/334), [#335](https://github.com/jarvinc3/personal-os-back/issues/335), [#337](https://github.com/jarvinc3/personal-os-back/issues/337), [#336](https://github.com/jarvinc3/personal-os-back/issues/336).
- Evidencia de la unidad: paquete local de revisión, no versionado; el alcance público vive en los issues.

Este documento fija el contrato objetivo de la importación por correo. No describe comportamiento desplegado. Los casos de prueba propuestos no están ejecutados y no se presentan como aprobados. La revisión independiente de Codex no es una aprobación. Sus hallazgos están incorporados en el paquete local y en este contrato.

## 0. Decisiones del owner (2026-11-11)

Estas decisiones cierran los puntos que estaban en `PENDIENTE CONCRETAR` y aplican a los cuatro flujos.

| #   | Decisión                                                                                                                                                                                      | Dónde se aplica     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | Dos correos con la misma referencia bancaria se comparan dentro de 7 días; no se exige la fecha exacta ni se usa la ventana de ±10 minutos del fallback.                                      | Secciones 3.4 y 4.4 |
| 2   | Un reverso que no encuentra su original queda en revisión sin crear movimiento y se vincula automáticamente cuando el original aparezca después.                                              | Sección 6.1         |
| 3   | Un pago de tarjeta confirmado por correo se vincula al pago manual parecido (monto, tarjeta y fecha cercana) sin crear un segundo pago; si hay duda, va a revisión.                           | Sección 4.3         |
| 4   | Un correo sin comercio se registra como "Comercio desconocido" y se marca para completar; no bloquea el registro.                                                                             | Sección 5.4         |
| 5   | Un reverso parcial se vincula a la compra original, que conserva su monto; el saldo sube y el gasto y el presupuesto bajan por lo devuelto. Si lo devuelto supera el original, va a revisión. | Sección 6.6         |

## 1. Alcance y estados

Los cuatro acuerdos de producto son:

1. Una transferencia con cuenta inequívoca registra solo el lado conocido y deja el emparejamiento pendiente. No se inventa la contraparte.
2. Un pago de tarjeta confirmado usa una ruta específica, se concilia con los pagos manuales y no crea duplicados ni doble gasto. Los recordatorios no crean movimientos.
3. Los datos faltantes usan motivos estables. La fecha del correo solo se sugiere con procedencia y exige confirmación antes de registrar.
4. Un reverso resuelve primero la referencia y luego la cadena del ADR-003. Un candidato único válido se vincula automáticamente con evidencia; cero, varios o ambiguos van a revisión. No se exige confirmación humana para todos los reversos.

El contrato separa tres estados:

| Estado                 | Significado                                                                  |
| ---------------------- | ---------------------------------------------------------------------------- |
| `ACORDADO`             | Decisión de producto o diseño técnico derivado, con justificación.           |
| `PENDIENTE CONCRETAR`  | Política abierta o ruta fuera de esta entrega; no se implementa por omisión. |
| `IMPLEMENTADO-PROBADO` | Existe código y prueba en un SHA exacto. Hoy no hay filas en este estado.    |

## 2. Contrato de señal

La señal `FINANCE.TRANSACTION_DETECTED` sigue siendo la entrada. El candidato `transaction` conserva sus campos y gana los siguientes.

| Campo                            | Obligatorio                  | Regla                                                                                                                                                                                                                                                  |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kind`                           | Sí                           | `TRANSACTION` o `PENDING`.                                                                                                                                                                                                                             |
| `movementClass`                  | Sí                           | Lista cerrada; se agrega `CARD_PAYMENT`.                                                                                                                                                                                                               |
| `direction`                      | Sí                           | `DEBIT`, `CREDIT` o `TRANSFER`.                                                                                                                                                                                                                        |
| `amount`, `currency`             | Sí                           | Monto positivo y moneda ISO 4217.                                                                                                                                                                                                                      |
| `transactionDate`                | Sí para importar             | Fecha de operación observada. Si solo hay fecha de encabezado, aplica la sección 5.                                                                                                                                                                    |
| `accountNumberLast4`             | Sí para transferencia y pago | Cuatro dígitos de la cuenta propia. Es la cuenta de origen en un pago de tarjeta. Campo nuevo.                                                                                                                                                         |
| `last4`                          | Solo tarjeta                 | Cuatro dígitos de la tarjeta. En una transferencia no se usa como cuenta.                                                                                                                                                                              |
| `bankReference`                  | No                           | Referencia visible del aviso. Se guarda en `externalReference`. No es única y no se exige para importar.                                                                                                                                               |
| `bankStatusNormalized`           | Sí para confirmar            | `APPROVED`, `COMPLETED` o `POSTED` confirman; `PENDING`, `IN_PROGRESS` o `AUTHORIZED` se registran como `PENDING`; `DECLINED`, `REJECTED` o `FAILED` como `DECLINED`, sin mover saldo; `REVERSED`, `REFUNDED` o `CHARGEBACK` van a la ruta de reverso. |
| `suggestedTransactionDate`       | No                           | Fecha que sugiere el correo, por ejemplo la del encabezado. No es la fecha de operación.                                                                                                                                                               |
| `suggestedTransactionDateSource` | Con la sugerencia            | En esta fase solo `EMAIL_HEADER`; la aporta el parser determinista.                                                                                                                                                                                    |
| `reverseOfBankReference`         | No                           | Referencia del original de un reverso. Equivale al `reverseOriginalRef` del ADR-003.                                                                                                                                                                   |
| `reverseOfEmailMessageId`        | No                           | Id del correo original de un reverso, cuando el mensaje lo permite. Es el `reverseOfEmailMessageId` del ADR-003.                                                                                                                                       |

La confianza menor a 0.7 o `UNKNOWN` deja el estado en `PENDING`, igual que el mapeo actual.

Decisiones de nombre y forma:

- Se usa un solo `accountNumberLast4` para transferencias y pagos. `last4` queda reservado para tarjeta; no se agrega `fromAccountNumberLast4`.
- `CARD_PAYMENT` se agrega a `MOVEMENT_CLASSES`; no se reutiliza `PURCHASE` ni `TRANSFER_OUT`.
- La referencia bancaria no se vuelve obligatoria ni única. Dos patas de la misma operación pueden compartirla.
- Los campos nuevos viajan en el JSON de clasificación y de señal. No requieren una columna nueva.

## 3. Transferencias

### 3.1 Resolución de la cuenta

- Solo cuentas activas del mismo usuario.
- La pista `accountNumberLast4` se compara con la misma regla de `accountMatchesHint` que ya usa `resolve-ledger-target-from-hints.ts`.
- No se usa la cuenta por defecto, la cuenta CASH ni una tarjeta.
- Resultado:
  - una cuenta: se importa la pata conocida;
  - cero: `TRANSFER_ACCOUNT_NOT_FOUND`, revisión;
  - varias: `TRANSFER_ACCOUNT_AMBIGUOUS`, revisión con candidatos;
  - sin pista: `TRANSFER_ACCOUNT_MISSING`, revisión;
  - solo `last4` de tarjeta: `TRANSFER_ACCOUNT_HINT_UNSUPPORTED`, revisión.

La cuenta debe ser inequívoca. Una pista parcial que coincide con varias cuentas no se resuelve por semejanza.

### 3.2 Pata conocida

Se crea una sola fila en `fin_transactions`:

| Campo               | Transferencia `OUT` | Transferencia `IN` |
| ------------------- | ------------------- | ------------------ |
| `type`              | `DEBIT`             | `CREDIT`           |
| `accountId`         | cuenta resuelta     | cuenta resuelta    |
| `cardId`            | `null`              | `null`             |
| `source`            | `EMAIL`             | `EMAIL`            |
| `importReference`   | id de la señal      | id de la señal     |
| `externalReference` | `bankReference`     | `bankReference`    |
| `transferGroupId`   | UUID nuevo          | UUID nuevo         |
| `legRole`           | `SOURCE`            | `DESTINATION`      |
| `categoryId`        | `null`              | `null`             |
| `status`            | estado del banco    | estado del banco   |

No se crea la contraparte. La pata queda visible como transferencia no emparejada. El listado puede mostrarla con su `transferGroupId` y una marca de pendiente; la cola de revisión es para correos que no se pudieron importar, no para una pata válida ya registrada.

### 3.3 Emparejamiento

Cuando llega una segunda señal válida, se aplica el comportamiento actual de `match-imported-transfers.ts`:

- mismo usuario;
- tipo opuesto;
- institución distinta (el código actual usa la institución, no solo la cuenta);
- misma moneda base del usuario;
- fecha dentro de 3 días, o de 7 cuando las dos patas comparten la referencia bancaria;
- monto exacto o tolerancia de comisión de 50 o 2 %;
- exactamente un candidato no emparejado después de aplicar la preferencia por monto exacto.

Si hay exactamente un candidato, se vinculan las dos patas con el mismo `transferGroupId`. Si hay cero, no se crea par. Si hay más de uno, no se elige por semejanza: las patas quedan pendientes y se registra `TRANSFER_PAIR_AMBIGUOUS` con evidencia.

Si al menos un candidato coincide con el monto exacto, los candidatos dentro de la tolerancia de comisión no compiten: se vincula el exacto si es único. Si no hay exacto, la tolerancia forma el conjunto y también debe ser única. Varios candidatos en el conjunto final no se eligen.

Una pata cuyo `transferGroupId` ya tiene otro miembro no se vuelve a emparejar. El tamaño del grupo se cuenta en la base por `transferGroupId`, sin limitarse a las patas que caen en la ventana de fechas de la búsqueda; así un par no se separa cuando su compañero quedó fuera de esa ventana.

El emparejamiento ocurre después de guardar la pata. Si ese paso falla, la pata queda guardada; el reintento de la misma señal vuelve a intentar el emparejamiento antes de responder `ALREADY_APPLIED`. No se crea una segunda pata.

La tolerancia de 50 o 2 % es comportamiento actual del código y se conserva. La ventana es de 3 días; con la misma referencia bancaria en las dos patas pasa a 7 días, por la decisión del owner del 2026-11-11 registrada en el issue #335.

### 3.4 Dedupe

- Replay de la misma señal: `fin_signal_import` existente, `ALREADY_APPLIED`, sin segunda fila.
- Un match de referencia es un candidato, no prueba de duplicado.
- Duplicado de la misma pata: misma referencia, mismo tipo, misma cuenta, mismo monto y misma moneda, con fecha de operación dentro de 7 días, `DUPLICATE`, sin segunda fila.
- Contraparte legítima: misma referencia, mismo usuario, tipo opuesto y cuenta distinta. No es duplicado ni conflicto; se importa la segunda pata y puede emparejar. La excepción se evalúa antes del conflicto y no se extiende a otros atributos.
- Conflicto de referencia: misma referencia que no es contraparte legítima; es decir, mismo tipo con cuenta, monto o moneda distintos, o fecha fuera de la ventana de 7 días, o tipo opuesto con la misma cuenta. No se descarta ni se crea otra fila en silencio; queda `TRANSFER_REFERENCE_CONFLICT` para revisión.
- Sin referencia: se usa el fallback del ADR-003 por destino, tipo, monto, moneda, comercio y fecha dentro de 10 minutos. Si el candidato es ambiguo, no se crea una segunda pata; se deja la evidencia para revisión.

La referencia compartida no basta para descartar la segunda pata. El dedupe de transferencias compara referencia más tipo y cuenta, y además monto y moneda; lo que no es contraparte legítima va a revisión.

Ventana temporal con la referencia presente: 7 días (decisión del owner del 2026-11-11). Dos correos con la misma referencia se comparan dentro de esa ventana; no se exige la fecha exacta ni se usa la ventana de ±10 minutos del fallback sin referencia. Con los mismos atributos, la misma pata dentro de la ventana es duplicado; fuera de ella va a `TRANSFER_REFERENCE_CONFLICT`. Las reglas de contraparte legítima no cambian.

### 3.5 Contabilidad

- Una pata con `transferGroupId` distinto de nulo no cuenta como gasto ni ingreso; solo la pata `FEE` cuenta como gasto.
- Al emparejar, las dos patas siguen excluidas del gasto. No hay gasto doble.
- No se toca presupuesto ni categoría de una pata de transferencia.

### 3.6 Motivos de revisión

Los motivos de transferencia (`TRANSFER_ACCOUNT_MISSING`, `TRANSFER_ACCOUNT_HINT_UNSUPPORTED`, `TRANSFER_ACCOUNT_NOT_FOUND`, `TRANSFER_ACCOUNT_AMBIGUOUS`, `TRANSFER_DIRECTION_AMBIGUOUS`, `TRANSFER_SIDE_MISSING`, `TRANSFER_PAIR_AMBIGUOUS`, `TRANSFER_REFERENCE_CONFLICT` y `REVERSAL_TARGET_NOT_SUPPORTED`) están en la tabla única de la sección 5.3.

## 4. Pagos de tarjeta confirmados

### 4.1 Alcance y resolución

- Solo un correo que confirma un pago de tarjeta de crédito desde una cuenta propia.
- Solo estados confirmados. Un aviso pendiente, un recordatorio o una fecha próxima no crean movimiento.
- La tarjeta se resuelve por `last4` entre tarjetas activas `CREDIT` del usuario.
- La cuenta de origen se resuelve por `accountNumberLast4` entre cuentas activas del usuario.
- No se usa la cuenta por defecto, la cuenta CASH, el remitente, el comercio ni el nombre para elegir.
- Si falta una pista, hay varias o la tarjeta no es `CREDIT`, la señal queda en revisión.

Los motivos de pago (`CARD_PAYMENT_NOT_CONFIRMED`, `CARD_PAYMENT_CARD_NOT_FOUND`, `CARD_PAYMENT_CARD_AMBIGUOUS`, `CARD_PAYMENT_CARD_NOT_CREDIT`, `CARD_PAYMENT_SOURCE_ACCOUNT_NOT_FOUND`, `CARD_PAYMENT_SOURCE_ACCOUNT_AMBIGUOUS`, `CARD_CURRENCY_MISSING` y `CARD_PAYMENT_REFERENCE_CONFLICT`) están en la tabla única de la sección 5.3.

### 4.2 Operación de dos patas

Se reutiliza la operación de `POST /api/finance/card-payments`, no se crea una compra:

- pata cuenta: `accountId` resuelto, `cardId` nulo, `type CARD_PAYMENT`, `legRole SOURCE`;
- pata tarjeta: `accountId` nulo, `cardId` resuelto, `type CARD_PAYMENT`, `legRole DESTINATION`;
- ambas: mismo `transferGroupId`, `source EMAIL`, `externalReference`, moneda, monto y fecha; `categoryId` nulo; sin presupuesto;
- solo la pata de origen lleva `importReference` de la señal. La pata de tarjeta no lo lleva porque la clave única `(userId, importReference)` no permite repetirlo; `fin_signal_import.transactionId` apunta a la pata de origen.

La cuenta baja y el disponible de la tarjeta sube. El pago no es gasto. El estado de cuenta calcula `paidAmount` y `payments` desde las patas `CARD_PAYMENT` confirmadas, igual que un pago manual; no hay una tabla de conciliación separada.

### 4.3 Conciliación con pagos manuales

La referencia es la primera pista, no prueba de duplicado.

1. Si el correo trae `bankReference`, se busca un pago existente del usuario por esa referencia en cualquier pata `CARD_PAYMENT`. La comparación es a nivel de operación o grupo, porque las dos patas comparten la referencia.
2. Un match de referencia es duplicado solo si la operación existente coincide en cuenta de origen, tarjeta, monto, moneda y fecha dentro de la ventana de 7 días. Si la referencia coincide con otra operación y difiere alguno de esos atributos, queda `CARD_PAYMENT_REFERENCE_CONFLICT` para revisión; no se crea ni se descarta.
3. Si no hay coincidencia por referencia, o el correo no trae referencia, se busca un pago parecido por misma cuenta de origen, misma tarjeta, mismo monto, misma moneda y fecha dentro de la ventana de dedupe del ADR-003. La búsqueda incluye pagos manuales sin referencia.
4. Si hay exactamente un candidato parecido y coincide en cuenta de origen, tarjeta, monto y moneda con fecha cercana, se vincula a ese pago: no se crean patas nuevas y la señal queda `DUPLICATE` o `ALREADY_APPLIED` con el pago existente en evidencia. Si la coincidencia no es clara, el correo queda en revisión con `CARD_PAYMENT_POSSIBLE_DUPLICATE` y el candidato en evidencia.
5. Si hay varios candidatos, queda `CARD_PAYMENT_RECONCILIATION_AMBIGUOUS` con los IDs y no se crea movimiento.
6. Si no hay candidato, el pago confirmado se importa una sola vez. La creación manual posterior con los mismos datos queda PENDIENTE CONCRETAR; no se promete 409 ni `duplicateAcknowledged` como acuerdo.

La ruta manual no cambia en este contrato. La opción de responder 409 y exigir `duplicateAcknowledged` queda PENDIENTE CONCRETAR: (A) bloquear con confirmación explícita, (B) solo advertir sin bloquear, (C) dejar la ruta manual intacta. Impacto: A evita dobles pero cambia la API manual; B no garantiza el objetivo; C deja el riesgo. No se implementa hasta decisión del owner.

### 4.4 Dedupe e idempotencia

- Replay de la misma señal: `ALREADY_APPLIED`, sin nuevas patas.
- Misma referencia y misma operación (cuenta, tarjeta, monto, moneda y fecha dentro de la ventana de 7 días): `DUPLICATE`, sin nuevas patas.
- Un pago manual parecido se vincula cuando coinciden cuenta de origen, tarjeta, monto, moneda y fecha cercana; no se crea un segundo pago.
- Misma referencia con cuenta, tarjeta, monto o moneda distintos: `CARD_PAYMENT_REFERENCE_CONFLICT`, revisión; no se crea ni se descarta.
- Dos correos distintos con la misma referencia y la misma operación: un solo pago.
- Dos pagos legítimos con referencias distintas: se permiten aunque compartan cuenta, tarjeta, monto y día.
- Sin referencia y sin candidato: se permite un solo pago; la opción de la ruta manual queda PENDIENTE CONCRETAR.
- Reintento después de un fallo de reclasificación: no duplica el pago ni la verificación.

### 4.5 Recordatorios

- Un recordatorio de pago o un aviso de corte no lleva `movementClass CARD_PAYMENT` y no crea movimiento.
- El scheduler `CardPaymentRemindersScheduler` y el evento `finance.card_payment.due` son salientes y no cambian.
- Si un recordatorio se clasifica por error como `CARD_PAYMENT`, la falta de monto, fecha de operación o estado confirmado lo manda a revisión; nunca crea un pago.
- No se infiere un pago por la fecha próxima, el saldo pendiente o el corte.

## 5. Datos faltantes y fecha sugerida

### 5.1 Regla

- Un dato ausente no se completa por inferencia.
- La fecha del encabezado no es la fecha de operación. Solo viaja como sugerencia con procedencia.
- Una sugerencia no autoriza a importar. El correo queda en revisión hasta que una persona confirme la fecha.
- Monto, moneda, instrumento y dirección siguen la misma regla: si faltan o son ambiguos, no se inventan y no se crea movimiento.

### 5.2 Campos y flujo

- `suggestedTransactionDate` y `suggestedTransactionDateSource` viven en la clasificación y en la respuesta de revisión.
- La procedencia `EMAIL_HEADER` la aporta el flujo que conoce `receivedAt`, después de validar la salida; el modelo no la inventa.
- Si existe `transactionDate`, manda esa fecha. La sugerencia se conserva como evidencia.
- Si solo existe la sugerencia, el motivo es `TRANSACTION_DATE_SUGGESTED`. La cola y el detalle muestran la fecha y su procedencia.
- La persona confirma o corrige con la verificación humana existente: `POST /api/intelligence/messages/:messageId/verifications` con `transaction.transactionDate`.
- Después de la verificación, el reintento usa la fecha confirmada. La sugerencia original queda en el historial de evidencia.
- No se crea una verificación implícita, no se marca `groundTruth` por la sugerencia y no se cambia la partición del dataset.

### 5.3 Motivos estables

Los códigos son estables; el texto visible puede cambiar sin cambiar el código. El número de candidatos y los IDs van en la evidencia, no en el código. Los códigos con sufijo `_n` del código actual son un detalle transitorio que se retira al implementar.

| Código                                  | Condición                                                                                                              | Efecto                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `AMOUNT_MISSING`                        | No hay monto.                                                                                                          | Sin movimiento.                                                                      |
| `CURRENCY_MISSING`                      | No hay moneda.                                                                                                         | Sin movimiento.                                                                      |
| `TRANSACTION_DATE_MISSING`              | No hay fecha de operación ni sugerencia.                                                                               | Sin movimiento.                                                                      |
| `TRANSACTION_DATE_SUGGESTED`            | Solo hay fecha de encabezado sugerida.                                                                                 | Sin movimiento hasta confirmación.                                                   |
| `DIRECTION_MISSING`                     | No se sabe si es débito, crédito o transferencia.                                                                      | Sin movimiento.                                                                      |
| `NO_LEDGER_TARGET`                      | No hay pista de cuenta o tarjeta.                                                                                      | Sin movimiento.                                                                      |
| `AMBIGUOUS_LEDGER_TARGET`               | Varias cuentas o tarjetas coinciden.                                                                                   | Sin movimiento; candidatos.                                                          |
| `TRANSFER_ACCOUNT_MISSING`              | Transferencia sin cuenta identificada.                                                                                 | Sin movimiento.                                                                      |
| `TRANSFER_ACCOUNT_HINT_UNSUPPORTED`     | Solo hay last4 de tarjeta en una transferencia.                                                                        | Sin movimiento.                                                                      |
| `TRANSFER_ACCOUNT_NOT_FOUND`            | Ninguna cuenta coincide.                                                                                               | Sin movimiento.                                                                      |
| `TRANSFER_ACCOUNT_AMBIGUOUS`            | Varias cuentas coinciden.                                                                                              | Sin movimiento; candidatos.                                                          |
| `TRANSFER_DIRECTION_AMBIGUOUS`          | La dirección de la transferencia es ambigua.                                                                           | Sin movimiento.                                                                      |
| `TRANSFER_SIDE_MISSING`                 | Falta el lado de la transferencia.                                                                                     | Sin movimiento.                                                                      |
| `TRANSFER_PAIR_AMBIGUOUS`               | Varias patas candidatas al emparejar.                                                                                  | La pata conocida sigue; no se inventa par.                                           |
| `TRANSFER_REFERENCE_CONFLICT`           | Misma referencia fuera de la contraparte legítima: mismo tipo con otros atributos, o tipo opuesto con la misma cuenta. | Revisión; no se descarta ni se crea en silencio.                                     |
| `CARD_PAYMENT_NOT_CONFIRMED`            | Pago no confirmado.                                                                                                    | Sin movimiento.                                                                      |
| `CARD_PAYMENT_CARD_NOT_FOUND`           | Tarjeta no encontrada.                                                                                                 | Sin movimiento.                                                                      |
| `CARD_PAYMENT_CARD_AMBIGUOUS`           | Varias tarjetas coinciden.                                                                                             | Sin movimiento; candidatos.                                                          |
| `CARD_PAYMENT_CARD_NOT_CREDIT`          | Tarjeta no es de crédito.                                                                                              | Sin movimiento.                                                                      |
| `CARD_PAYMENT_SOURCE_ACCOUNT_NOT_FOUND` | Cuenta de origen no encontrada.                                                                                        | Sin movimiento.                                                                      |
| `CARD_PAYMENT_SOURCE_ACCOUNT_AMBIGUOUS` | Varias cuentas de origen.                                                                                              | Sin movimiento; candidatos.                                                          |
| `CARD_CURRENCY_MISSING`                 | La tarjeta no tiene saldo en la moneda.                                                                                | Sin movimiento.                                                                      |
| `CARD_PAYMENT_POSSIBLE_DUPLICATE`       | Pago parecido sin coincidencia clara.                                                                                  | Revisión; con coincidencia clara se vincula al pago manual.                          |
| `CARD_PAYMENT_REFERENCE_CONFLICT`       | Misma referencia con atributos distintos.                                                                              | Revisión; no se descarta ni se crea en silencio.                                     |
| `CARD_PAYMENT_RECONCILIATION_AMBIGUOUS` | Varios pagos parecidos.                                                                                                | Sin movimiento; candidatos.                                                          |
| `REVERSAL_ORIGINAL_NOT_FOUND`           | No hay original sin referencia explícita.                                                                              | Sin movimiento; se reintenta cuando el original aparezca.                            |
| `REVERSAL_REFERENCE_NOT_FOUND`          | Referencia explícita sin original elegible.                                                                            | Revisión; no usa candidato por heurística; se reintenta cuando el original aparezca. |
| `REVERSAL_COMMERCE_MISSING`             | Reverso sin comercio para candidatos.                                                                                  | Revisión; no auto-vincula.                                                           |
| `REVERSAL_ORIGINAL_AMBIGUOUS`           | Varios originales posibles.                                                                                            | Sin movimiento; candidatos.                                                          |
| `REVERSAL_ORIGINAL_NOT_CONFIRMED`       | El original no está confirmado.                                                                                        | Sin movimiento.                                                                      |
| `REVERSAL_TARGET_NOT_SUPPORTED`         | El original es transferencia o pago de tarjeta.                                                                        | Sin movimiento por la ruta de compras.                                               |
| `REVERSAL_CURRENCY_MISMATCH`            | La moneda del reverso no coincide con la del original.                                                                 | Sin movimiento; no se crea un crédito en otra moneda.                                |
| `REVERSAL_EXCEEDS_ORIGINAL`             | El monto devuelto, sumado a los reversos parciales previos, supera el monto del original.                              | Sin movimiento.                                                                      |

### 5.4 Comercio ausente

- Un correo sin comercio no bloquea el registro. El movimiento se guarda con `merchant = "Comercio desconocido"` y la marca `aiMetadata.merchantMissing = true` para completarlo después.
- La marca no es un motivo de revisión y no cambia el estado del movimiento.
- La búsqueda de comercio, la sugerencia de categoría y el emparejamiento no usan el texto de relleno como si fuera un comercio real.
- En los candidatos de reverso el comercio sigue siendo obligatorio (sección 6.3); la regla de relleno aplica al movimiento que se registra, no al auto-vínculo del reverso.

## 6. Reversos

### 6.1 Cadena de resolución

El ADR-003 define tres pasos. El contrato los conserva en ese orden:

| Paso | Nombre en el ADR          | Campo o dato actual        | Regla                                                                                                               |
| ---- | ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1    | `reverseOriginalRef`      | `reverseOfBankReference`   | Referencia exacta del original. No se usa `bankReference` de la reversión.                                          |
| 2    | `reverseOfEmailMessageId` | id del correo original     | Solo si no hay referencia bancaria: se busca el original por el id del mensaje, cuando está disponible.             |
| 3    | candidatos                | `findCandidatesForReverse` | Solo si no hay referencia y el id de correo no resolvió: ±14 días, mismo monto, moneda y comercio; un único válido. |

Reglas de la cadena:

- La referencia es primero. Si encuentra un original elegible, se revierte ese original aunque existan otros candidatos por monto y fecha.
- La referencia no es única: se leen todos los movimientos que la comparten. Si hay más de uno, el caso queda en revisión `REVERSAL_ORIGINAL_AMBIGUOUS` con los candidatos en la evidencia; no se elige el más reciente.
- Si la referencia apunta a una pata de transferencia, a un pago de tarjeta o a un original ya `REVERSED`, no se busca un candidato alternativo: se revisa o se devuelve `ALREADY_APPLIED`.
- Si la referencia existe y no encuentra original, el caso queda en revisión `REVERSAL_REFERENCE_NOT_FOUND`; no se usa un candidato por heurística. Se reintenta la misma cadena cuando aparezca el original.
- Si no hay referencia, se busca por el id de correo y luego por candidatos; el paso usado queda en la evidencia.
- Si el original no aparece, el reverso queda en revisión sin crear movimiento y se reintenta cada vez que se importa un movimiento nuevo del mismo usuario. Si el original aparece, se vincula automáticamente y la fila de revisión pasa al resultado del vínculo (decisión 2 del owner).
- Un candidato único válido se vincula automáticamente. No se exige confirmación humana para todos los reversos.
- Cero candidatos, varios candidatos o un candidato no elegible dejan el reverso en revisión sin compensar nada.

### 6.2 Elegibilidad del original

El original debe cumplir:

- mismo usuario;
- `status CONFIRMED`;
- `type DEBIT`;
- `transferGroupId` nulo;
- no ser `CARD_PAYMENT`;
- no estar ya `REVERSED`.

Resultados:

| Caso                              | Resultado                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------- |
| Original no confirmado            | `REVERSAL_ORIGINAL_NOT_CONFIRMED`, revisión.                                    |
| Original es transferencia o pago  | `REVERSAL_TARGET_NOT_SUPPORTED`, revisión.                                      |
| Original ya `REVERSED`            | `ALREADY_APPLIED`, sin segunda compensación.                                    |
| Referencia explícita sin original | `REVERSAL_REFERENCE_NOT_FOUND`, revisión; se reintenta al aparecer el original. |
| Sin referencia y sin candidato    | `REVERSAL_ORIGINAL_NOT_FOUND`, revisión; se reintenta al aparecer el original.  |
| Candidato sin comercio            | `REVERSAL_COMMERCE_MISSING`, revisión.                                          |
| Varios candidatos                 | `REVERSAL_ORIGINAL_AMBIGUOUS`, revisión.                                        |
| Moneda distinta a la del original | `REVERSAL_CURRENCY_MISMATCH`, revisión.                                         |
| Monto devuelto mayor al original  | `REVERSAL_EXCEEDS_ORIGINAL`, revisión.                                          |
| Monto devuelto igual al original  | Reverso total: el original pasa a `REVERSED`.                                   |
| Monto devuelto menor al original  | Reverso parcial: fila `CREDIT` vinculada; el original sigue `CONFIRMED`.        |

### 6.3 Candidatos

Solo cuando no hay referencia bancaria y el id de correo no resolvió un original:

- mismo usuario;
- `type DEBIT`;
- `status CONFIRMED`;
- `transferGroupId` nulo;
- no `CARD_PAYMENT`;
- monto exacto al aviso de reverso;
- misma moneda;
- fecha de la transacción dentro de ±14 días de la fecha del reverso;
- comercio obligatorio del ADR-003;
- no `REVERSED`.

El comercio es obligatorio para el auto-vínculo. Si el aviso no trae comercio, `REVERSAL_COMMERCE_MISSING` y revisión; no se auto-vincula con monto, moneda y fecha solos. El comercio no desempata entre varios candidatos: la unicidad sigue siendo obligatoria. No se usa remitente ni semejanza de texto para elegir.

### 6.4 Operación

- Se usa `ReverseTransactionUseCase` sobre el original elegido.
- El original pasa a `REVERSED`; se conserva la fila y su vínculo.
- `fin_signal_import` queda `REVERSED` con el `transactionId` del original y la evidencia de la búsqueda.
- La evidencia registra `reversalSignalId`, `reversalSourceEmailMessageId`, el paso usado (`REFERENCE`, `EMAIL` o `CANDIDATE`) y los IDs de los candidatos.
- Un reverso parcial no marca el original: crea una fila `CREDIT` vinculada (sección 6.6) y `fin_signal_import` queda `IMPORTED` con el `transactionId` de esa fila.
- No se crea `groundTruth` ni una verificación humana por el reverso.

### 6.5 Idempotencia

- Replay de la misma señal: `ALREADY_APPLIED`, sin segunda compensación.
- Segundo reverso con la misma referencia sobre un original ya `REVERSED`: `ALREADY_APPLIED`.
- Segundo reverso parcial del mismo aviso (mismo `sourceEmailMessageId`) sobre el mismo original: no crea una segunda fila vinculada; la señal queda `ALREADY_APPLIED` con la fila existente. Dos avisos de correos distintos con el mismo monto y moneda sí crean filas separadas mientras la suma no supere el original.
- Segundo reverso sin referencia que no encuentra un candidato vigente porque el original ya está `REVERSED`: revisión `REVERSAL_ORIGINAL_NOT_FOUND`, sin segunda compensación.
- Dos reversos distintos con candidatos distintos: se procesan por separado.
- Un reverso de un reverso no se vincula al original revertido; va a revisión.

### 6.6 Reverso parcial

Un aviso de reverso con monto menor al del original es un reverso parcial (decisión 5).

- El original conserva su monto, su estado `CONFIRMED` y su categoría.
- Se crea una fila `type CREDIT` con el monto devuelto, `source EMAIL`, `importReference` de la señal, `externalReference` del aviso, `linkedTransactionId` del original, `transferGroupId` nulo y `categoryId` del original.
- El instrumento es el del original: su misma cuenta o su misma tarjeta. El saldo sube por el monto devuelto.
- El gasto del período y el presupuesto bajan por el monto devuelto, en la fecha del aviso de reverso. Los reportes y el estado del presupuesto restan la fila vinculada; el comercio de la fila es el del aviso o "Comercio desconocido" si falta.
- Si el monto devuelto supera el del original: `REVERSAL_EXCEEDS_ORIGINAL`, revisión, sin fila y sin cambio de saldo.
- El tope se evalúa sobre el acumulado: los créditos ya vinculados al original, en la misma moneda, más el monto del aviso. Si la suma supera el original, `REVERSAL_EXCEEDS_ORIGINAL`, revisión y sin fila.
- La comprobación del acumulado y la creación del crédito ocurren en la misma transacción, con la fila del original bloqueada. Dos avisos simultáneos se serializan; el segundo ve el crédito del primero y va a revisión si la suma supera el original.
- La evidencia de la señal registra el paso, el original y el monto devuelto.

## 7. Dedupe y conciliación

- La referencia bancaria no es única. El índice actual `(user_id, external_reference)` no impone unicidad y no se agrega una restricción única.
- Un match de referencia es un candidato, no prueba de duplicado. En una operación de dos patas, las dos comparten `externalReference`; el dedupe se hace a nivel de operación o con referencia más tipo, cuenta, monto y moneda.
- Si la referencia coincide pero los atributos de la operación difieren, el caso va a revisión (`TRANSFER_REFERENCE_CONFLICT` o `CARD_PAYMENT_REFERENCE_CONFLICT`); no se descarta ni se crea en silencio. Queda fuera de esta regla la contraparte legítima de una transferencia: misma referencia, mismo usuario, tipo opuesto y cuenta distinta no es duplicado ni conflicto (sección 3.4).
- En una compra, el dedupe sigue el ADR-003: primero `externalReference`; si falta, mismo destino, monto, moneda, tipo, comercio y fecha dentro de 10 minutos.
- En una transferencia, el fallback sin referencia usa destino, tipo, monto, moneda y fecha dentro de 10 minutos; la referencia compartida por la contraparte no es duplicado.
- En un pago de tarjeta, el fallback incluye pagos manuales sin referencia. Si el candidato coincide en cuenta, tarjeta, monto, moneda y fecha cercana, se vincula; si la coincidencia no es clara o hay varios, va a revisión.
- No se infiere una referencia que el correo no trae. No se exige una referencia única para resolver el pago.

## 8. Estados del contrato

### 8.1 Acordado

- Transferencia: una pata conocida, emparejamiento pendiente y contraparte no inventada.
- Pago de tarjeta: dos patas `CARD_PAYMENT`, sin gasto, conciliadas con pagos manuales y sin duplicados.
- Recordatorios: no crean movimientos.
- Fecha del correo: solo sugerencia con procedencia; confirmación humana antes de registrar.
- Reverso: referencia primero; sin referencia, id de correo y candidatos; candidato único válido automático, cero o varios a revisión. Una referencia explícita sin original queda en revisión y se vincula cuando el original aparezca.
- Reverso parcial: se vincula a la compra original, que conserva su monto; el gasto y el presupuesto bajan por lo devuelto.
- Reversos: no se exige confirmación universal.
- Comercio ausente: se registra como "Comercio desconocido" y se marca para completar; no bloquea el registro.
- Referencia compartida: dos patas de la misma operación no son duplicado ni conflicto; la ventana es de 7 días.
- Referencia bancaria: no es obligatoria ni única; un match es candidato y un conflicto de atributos va a revisión. La contraparte legítima (tipo opuesto y cuenta distinta) no es duplicado ni conflicto. El fallback y la conciliación manual cubren su ausencia.

### 8.2 Pendiente concretar

- Creación manual posterior a un pago importado por correo: no se promete 409 ni `duplicateAcknowledged`.
- Ruta manual ante un pago parecido: opciones (A) bloqueo con `duplicateAcknowledged`, (B) aviso sin bloqueo, (C) ruta intacta. Cambia la API y el objetivo de no duplicar; no está aprobada.
- Comercio ausente en candidatos de reverso: revisión; el ADR-003 lo exige y no se auto-vincula solo por monto, moneda y fecha.
- Reverso de transferencias y de pagos de tarjeta: ruta específica fuera de estos cuatro issues; por ahora `REVERSAL_TARGET_NOT_SUPPORTED`.
- Texto visible y ubicación de los motivos en la UI: los códigos son estables; el texto puede cambiar.
- Piloto BHD: bloqueado por CTR-02 y por la implementación de estos contratos; no se inicia aquí.

### 8.3 Implementado y probado

| Unidad  | Qué quedó                                                                                                                                                                                            | Evidencia                                                                                                |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| PR #335 | Pago de tarjeta de correo, dos patas y conciliación con la ruta manual.                                                                                                                              | `develop`; pruebas unitarias y de integración                                                            |
| PR #340 | Una sola pata de transferencia: cuenta por `accountNumberLast4`, `transferGroupId`, `legRole`, motivos estables, duplicado, contraparte legítima y conflicto de referencia.                          | `6c15b2f`; pruebas de `resolve-transfer-import.spec.ts` y del consumidor                                 |
| PR #348 | Emparejamiento de transferencias con candidato único, ventana de 7 días con referencia compartida y recuperación por reintento; no parte grupos ya emparejados.                                      | `develop`; pruebas unitarias, E2E e integración                                                          |
| PR #343 | Fecha del encabezado sugerida con fuente, sin inventar `transactionDate`, propagada a persistencia y señal.                                                                                          | `develop`; pruebas de clasificación y señal                                                              |
| PR #342 | Selección acotada de muestra, vista previa sin escrituras y ejecución idempotente en DEV/local.                                                                                                      | `develop`; pruebas unitarias, E2E e integración                                                          |
| #337    | El clasificador ya envía la sugerencia; la cola de revisión y la confirmación antes de registrar siguen pendientes.                                                                                  | Parcial; issue #337                                                                                      |
| PR #345 | Cadena de reversos por referencia, id de correo y candidato único con evidencia; reintento cuando aparece el original; parcial vinculado con límite acumulado decimal; comercio desconocido marcado. | Pruebas del consumidor, `resolve-reversal-target.spec.ts`, PostgreSQL, lector de presupuesto y analítica |

Los casos `T-TRA`, `T-TAR`, `T-DAT` y `T-REV` son propuestos y no ejecutados: no hay una corrida completa del contrato. La QA sintética existente y CTR-02 se conservan en `temp/pr331-test-reports/` y no certifican estos cambios.

## 9. Evidencia actual y brechas

| Afirmación del contrato                                   | Código actual                                                                                                                                                                                  | Estado                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| La transferencia resuelve una cuenta propia               | `resolveTransferAccount` compara `accountNumberLast4` con cuentas activas del usuario; no usa tarjeta, CASH ni cuenta por defecto (`resolve-transfer-import.ts`).                              | `IMPLEMENTADO` (PR #340)    |
| La transferencia crea una sola pata con rol               | `executeUnpairedTransfer` crea el grupo y el repositorio persiste `legRole` (`prisma-ledger-import.repository.ts`).                                                                            | `IMPLEMENTADO` (PR #340)    |
| El emparejamiento usa ventana por referencia y tolerancia | `match-imported-transfers.ts` usa 3 días, o 7 con referencia compartida; conserva tolerancia y exige un candidato único.                                                                       | `VERIFICADO` (PR #348)      |
| La referencia compartida identifica la misma pata         | `classifyTransferImport` compara referencia, tipo, cuenta, monto, moneda y fecha dentro de 7 días; la contraparte legítima se importa.                                                         | `IMPLEMENTADO` (PR #348)    |
| El pago de tarjeta reutiliza dos patas                    | El correo llama `ImportCardPaymentUseCase`, que concilia pagos manuales y crea dos patas `CARD_PAYMENT` sin gasto.                                                                             | `IMPLEMENTADO` (PR #335)    |
| El clasificador emite las pistas                          | Esquema y prompt incluyen `accountNumberLast4`, `CARD_PAYMENT`, fecha sugerida con fuente y `reverseOfEmailMessageId`; la fecha recibida se aplica fuera del modelo.                           | `IMPLEMENTADO` (PR #343)    |
| La fecha del encabezado es solo sugerencia                | La sugerencia llega desde el clasificador; la fila de revisión y la confirmación del consumidor siguen pendientes en #337.                                                                     | `PARCIALMENTE IMPLEMENTADO` |
| El reverso sigue la cadena del ADR-003                    | `resolveReversal` resuelve por `reverseOfBankReference`, luego `reverseOfEmailMessageId` y después candidato único cuando no hay referencia explícita; no usa `bankReference` de la reversión. | `IMPLEMENTADO` (PR #345)    |
| El reverso filtra tipo, transferencia y tarjeta           | `findCandidatesForReverse` filtra usuario, estado, `type DEBIT`, `transferGroupId` nulo, moneda, monto, ±14 días y comercio (`prisma-ledger-read.repository.ts`).                              | `IMPLEMENTADO` (PR #345)    |
| El reverso pendiente se vincula al aparecer el original   | Tras importar un movimiento se reintentan los reversos en revisión con `REVERSAL_ORIGINAL_NOT_FOUND` o `REVERSAL_REFERENCE_NOT_FOUND` (`finance-signal-consumer.ts`).                          | `IMPLEMENTADO` (PR #345)    |
| El reverso parcial mantiene el monto original y su tope   | Fila `CREDIT` vinculada; el original sigue `CONFIRMED`; suma y límite decimal exactos dentro de la transacción; el gasto y el presupuesto se ajustan por lo devuelto.                          | `IMPLEMENTADO` (PR #345)    |
| El correo sin comercio se registra y se marca             | Se guarda `Comercio desconocido` con `aiMetadata.merchantMissing`; el texto de relleno no se resuelve como comercio (`unknown-merchant.ts`).                                                   | `IMPLEMENTADO` (PR #345)    |
| La pata de tarjeta no repite `importReference`            | La clave única `(userId, importReference)` existe (`schema.prisma:811`); la ruta de correo está implementada en el PR #335.                                                                    | `IMPLEMENTADO` (PR #335)    |

La tolerancia de 50 o 2 % y la ventana de 10 minutos del ADR son comportamiento existente. La ventana de emparejamiento es de 3 días, y de 7 cuando las dos patas comparten referencia, por decisión del owner. La ventana de ±14 días del reverso viene del ADR-003 y no se cambia por inferencia.

## 10. Pruebas

Los casos propuestos viven en el paquete local de revisión y se resumen en los issues:

- `T-TRA`: una pata, cuenta ambigua, solo tarjeta, referencia compartida, conflicto de referencia en operaciones distintas, emparejamiento único y ambiguo, replay, aislamiento y estado pendiente. El emparejamiento tiene pruebas de unidad de la ventana (3 y 7 días), del consumidor (llamada, ausencia y evidencia de ambigüedad) y de integración (dos patas en un solo grupo, sin categoría).
- `T-TAR`: dos patas, saldos, estado de cuenta, pago manual con y sin referencia, referencia conflictiva, recordatorio, tarjeta o cuenta inválida, replay, dos pagos legítimos, aislamiento y opciones manuales pendientes.
- `T-DAT`: monto, moneda, fecha, sugerencia, confirmación, instrumento, replay, ausencia de verificación implícita y aislamiento.
- `T-REV`: referencia, correo, candidato único, cero, varios, referencia explícita sin match, comercio ausente, transferencia, pago de tarjeta, parcial, otro usuario, fuera de ventana y replay.

Un caso solo se marca PASS cuando el contrato está implementado y el caso se ejecutó completo en el SHA exacto. Un caso propuesto no es una prueba ejecutada.

Las pruebas de esta unidad cubren la cadena de reverso, el reverso parcial con su efecto en gasto y presupuesto, el reintento cuando el original aparece y el comercio desconocido. Son pruebas de unidad; no sustituyen los casos `T-*`.

## 11. Selección acotada de muestra (piloto BHD)

- Estado: `IMPLEMENTADO-PROBADO` para la selección, vista previa y ejecución de la muestra. Los flujos financieros de
  las secciones 3 a 6 tienen estado independiente en la sección 8.3.
- Fecha: 2026-11-11.
- Issue: [#342](https://github.com/jarvinc3/personal-os-back/issues/342).
- Ruta: `POST /api/intelligence/email/sample-import`.

### 11.1 Selección

Una llamada usa una sola forma de selección:

- `messageIds`: lista explícita. Tope 20. Más de 20 responde 400 sin tocar nada.
- `sender` con `dateFrom` y `dateTo`: ventana de fechas sobre la recepción.

Enviar las dos formas, o ninguna, responde 400. El remitente se compara exacto con
`fromDomain` o con `fromAddress`, sin distinguir mayúsculas. No hay coincidencia
por semejanza ni por nombre de institución. Solo entran correos del usuario
autenticado.

### 11.2 Vista previa (`dryRun: true`)

- Reclasifica con el modelo todos los correos seleccionados, también los que ya
  tienen clasificación guardada, porque la guardada puede ser anterior a las
  pistas nuevas.
- No escribe nada: ni clasificaciones, ni observaciones, ni presupuesto de
  modelo, ni telemetría de inferencia, ni señales, ni eventos de salida, ni
  movimientos. La llamada al modelo viaja con `recordTelemetry: false`.
- Devuelve un manifiesto por correo.

La predicción del movimiento no repite las reglas: usa el mismo paso de decisión
que la ejecución (`FinanceSignalConsumer.preview`). Vista previa y escritura
comparten código, así el manifiesto no se separa del resultado.

### 11.3 Ejecución (`dryRun: false`)

- Procesa solo los ids de la lista. No amplía la selección por remitente ni por
  plantilla ni reclasifica correos fuera de la lista.
- Reclasifica cada correo seleccionado y reemplaza su clasificación guardada.
- Publica la señal y aplica el movimiento llamando al consumidor de Finance en el
  mismo proceso. La operación no depende de la cola para aplicar el movimiento.
- Idempotente: la señal usa `email-{messageId}` y el import conserva su clave
  única. Repetir la misma corrida devuelve `ALREADY_APPLIED` sin duplicar señal ni
  movimiento.
- La señal se registra en el evento de salida como en la clasificación normal. El
  trabajo encolado no vuelve a aplicar el movimiento porque la señal queda
  consumida.

### 11.4 Manifiesto

| Campo                             | Contenido                                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `messageId`                       | Id del correo pedido.                                                                                                   |
| `status`                          | `INCLUDED` o `NOT_FOUND`.                                                                                               |
| `fromAddress`, `fromDomain`       | Remitente persistido.                                                                                                   |
| `receivedAt`                      | Fecha de recepción del correo, no la de operación.                                                                      |
| `classification`                  | Tipo, confianza, método, clase de movimiento, monto, moneda, fecha de operación, fecha sugerida con fuente y dirección. |
| `classificationUnavailableReason` | Motivo cuando la clasificación no se pudo calcular.                                                                     |
| `hints`                           | Referencia bancaria, comercio, `last4` y fecha sugerida con fuente observados.                                          |
| `signal.published`                | Si el correo publicaría una señal `FINANCE.TRANSACTION_DETECTED`.                                                       |
| `signal.reason`                   | Motivo cuando no publica.                                                                                               |
| `prediction`                      | Resultado previsto y, si aplica, el movimiento que crearía.                                                             |
| `execution`                       | Solo al ejecutar: resultado aplicado y id del movimiento.                                                               |

### 11.5 Diferencias posibles entre vista previa y ejecución

- La clasificación se recalcula al ejecutar. El modelo puede devolver otra
  confianza u otro tipo; el manifiesto de cada corrida es la evidencia.
- Dos correos de la misma muestra pueden competir por el mismo movimiento. El
  segundo ve el estado que dejó el primero.
- El cierre de cajero automático y el reintento por clave duplicada se resuelven
  al escribir, no en la predicción.

### 11.6 Límites

- Solo entornos que no sean producción: la ruta responde 404 cuando
  `NODE_ENV=production`.
- Un solo escritor y una corrida a la vez sobre la misma base.
- `POST /email/sync` y `POST /email/reset` no se usan.
- La operación usa los flujos que figuran implementados en la sección 8.3. La
  revisión y confirmación de la fecha sugerida del issue #337 siguen pendientes.

### 11.7 Tiempo de respuesta

- La selección está limitada a 20 correos y se procesa en serie. Tanto la vista
  previa como la ejecución usan un timeout de ruta de 180 segundos para dar
  margen al modelo en una muestra completa. El interceptor global conserva sus
  5 segundos por defecto en las demás rutas.
- Si vence el límite de 180 segundos, el cliente recibe 408. El timeout corta la
  respuesta, pero no cancela una operación que ya esté ejecutándose. La vista
  previa no escribe; la ejecución es idempotente por correo, así que el cliente
  debe consultar el estado antes de repetirla.
