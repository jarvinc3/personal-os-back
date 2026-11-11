# Importación por correo: transferencias, pagos, datos faltantes y reversos

- Estado: contrato acordado. La transferencia de una pata (#340), el pago de tarjeta (#335) y la muestra con vista previa (#342) están implementados; este cambio completa las pistas de clasificación. La revisión de fecha y confirmación del consumidor sigue pendiente en #337.
- Fecha: 2026-11-11.
- Base integrada: `develop` `9f711eb4131c8ed9b3e6a21c05507e5f12a6f49f`.
- Issues: [#334](https://github.com/jarvinc3/personal-os-back/issues/334), [#335](https://github.com/jarvinc3/personal-os-back/issues/335), [#337](https://github.com/jarvinc3/personal-os-back/issues/337), [#336](https://github.com/jarvinc3/personal-os-back/issues/336).
- Evidencia de la unidad: paquete local de revisión, no versionado; el alcance público vive en los issues.

Este documento fija el contrato objetivo de la importación por correo. No describe comportamiento desplegado. Los casos de prueba propuestos no están ejecutados y no se presentan como aprobados. La revisión independiente de Codex no es una aprobación. Sus hallazgos están incorporados en el paquete local y en este contrato.

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
| `IMPLEMENTADO-PROBADO` | Existe código y prueba en un SHA exacto.                                     |

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
- exactamente un candidato no emparejado.

Si hay exactamente un candidato, se vinculan las dos patas con el mismo `transferGroupId`. Si hay cero o más de uno, no se elige por semejanza: las patas quedan pendientes y se registra `TRANSFER_PAIR_AMBIGUOUS` con evidencia.

La tolerancia de 50 o 2 % es comportamiento actual del código y se conserva. La ventana es de 3 días; con la misma referencia bancaria en las dos patas pasa a 7 días, por la decisión del owner del 2026-11-11 registrada en el issue #335.

### 3.4 Dedupe

- Replay de la misma señal: `fin_signal_import` existente, `ALREADY_APPLIED`, sin segunda fila.
- Un match de referencia es un candidato, no prueba de duplicado.
- Duplicado de la misma pata: misma referencia, mismo tipo, misma cuenta, mismo monto, misma moneda y la misma fecha de operación, `DUPLICATE`, sin segunda fila.
- Contraparte legítima: misma referencia, mismo usuario, tipo opuesto y cuenta distinta. No es duplicado ni conflicto; se importa la segunda pata y puede emparejar. La excepción se evalúa antes del conflicto y no se extiende a otros atributos.
- Conflicto de referencia: misma referencia que no es contraparte legítima; es decir, mismo tipo con cuenta, monto, moneda o fecha distintos, o tipo opuesto con la misma cuenta. No se descarta ni se crea otra fila en silencio; queda `TRANSFER_REFERENCE_CONFLICT` para revisión.
- Sin referencia: se usa el fallback del ADR-003 por destino, tipo, monto, moneda, comercio y fecha dentro de 10 minutos. Si el candidato es ambiguo, no se crea una segunda pata; se deja la evidencia para revisión.

La referencia compartida no basta para descartar la segunda pata. El dedupe de transferencias compara referencia más tipo y cuenta, y además monto y moneda; lo que no es contraparte legítima va a revisión.

Ventana temporal con la referencia presente: PENDIENTE CONCRETAR. Los ±10 minutos del ADR-003 justifican solo el fallback sin referencia; el ADR no define una ventana para una referencia presente. Mientras el owner no decida, una coincidencia de referencia con los mismos atributos y fecha distinta va a `TRANSFER_REFERENCE_CONFLICT` para revisión; no se descarta y no se presenta como regla acordada.

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
2. Un match de referencia es duplicado solo si la operación existente coincide en cuenta de origen, tarjeta, monto, moneda y fecha dentro de la ventana del ADR-003. Si la referencia coincide con otra operación y difiere alguno de esos atributos, queda `CARD_PAYMENT_REFERENCE_CONFLICT` para revisión; no se crea ni se descarta.
3. Si no hay coincidencia por referencia, o el correo no trae referencia, se busca un pago parecido por misma cuenta de origen, misma tarjeta, mismo monto, misma moneda y fecha dentro de la ventana de dedupe del ADR-003. La búsqueda incluye pagos manuales sin referencia.
4. Si hay exactamente un candidato parecido, el correo se vincula a ese pago: queda `DUPLICATE` con el pago en evidencia y no se crean filas nuevas. La vinculación es la decisión del owner del 2026-11-11; el código `CARD_PAYMENT_POSSIBLE_DUPLICATE` queda reservado para cuando la vinculación no proceda.
5. Si hay varios candidatos, queda `CARD_PAYMENT_RECONCILIATION_AMBIGUOUS` con los IDs y no se crea movimiento.
6. Si no hay candidato, el pago confirmado se importa una sola vez. La creación manual posterior con los mismos datos queda PENDIENTE CONCRETAR; no se promete 409 ni `duplicateAcknowledged` como acuerdo.

La ruta manual no cambia en este contrato. La opción de responder 409 y exigir `duplicateAcknowledged` queda PENDIENTE CONCRETAR: (A) bloquear con confirmación explícita, (B) solo advertir sin bloquear, (C) dejar la ruta manual intacta. Impacto: A evita dobles pero cambia la API manual; B no garantiza el objetivo; C deja el riesgo. No se implementa hasta decisión del owner.

### 4.4 Dedupe e idempotencia

- Replay de la misma señal: `ALREADY_APPLIED`, sin nuevas patas.
- Misma referencia y misma operación (cuenta, tarjeta, monto, moneda y fecha dentro de la ventana): `DUPLICATE`, sin nuevas patas. La ventana es de siete días; sin referencia son tres días. Las dos duraciones las fijó el owner y están registradas en el comentario de decisiones del issue #335.
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

| Código                                  | Condición                                                                                                              | Efecto                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `AMOUNT_MISSING`                        | No hay monto.                                                                                                          | Sin movimiento.                                                       |
| `CURRENCY_MISSING`                      | No hay moneda.                                                                                                         | Sin movimiento.                                                       |
| `TRANSACTION_DATE_MISSING`              | No hay fecha de operación ni sugerencia.                                                                               | Sin movimiento.                                                       |
| `TRANSACTION_DATE_SUGGESTED`            | Solo hay fecha de encabezado sugerida.                                                                                 | Sin movimiento hasta confirmación.                                    |
| `DIRECTION_MISSING`                     | No se sabe si es débito, crédito o transferencia.                                                                      | Sin movimiento.                                                       |
| `NO_LEDGER_TARGET`                      | No hay pista de cuenta o tarjeta.                                                                                      | Sin movimiento.                                                       |
| `AMBIGUOUS_LEDGER_TARGET`               | Varias cuentas o tarjetas coinciden.                                                                                   | Sin movimiento; candidatos.                                           |
| `TRANSFER_ACCOUNT_MISSING`              | Transferencia sin cuenta identificada.                                                                                 | Sin movimiento.                                                       |
| `TRANSFER_ACCOUNT_HINT_UNSUPPORTED`     | Solo hay last4 de tarjeta en una transferencia.                                                                        | Sin movimiento.                                                       |
| `TRANSFER_ACCOUNT_NOT_FOUND`            | Ninguna cuenta coincide.                                                                                               | Sin movimiento.                                                       |
| `TRANSFER_ACCOUNT_AMBIGUOUS`            | Varias cuentas coinciden.                                                                                              | Sin movimiento; candidatos.                                           |
| `TRANSFER_DIRECTION_AMBIGUOUS`          | La dirección de la transferencia es ambigua.                                                                           | Sin movimiento.                                                       |
| `TRANSFER_SIDE_MISSING`                 | Falta el lado de la transferencia.                                                                                     | Sin movimiento.                                                       |
| `TRANSFER_PAIR_AMBIGUOUS`               | Varias patas candidatas al emparejar.                                                                                  | La pata conocida sigue; no se inventa par.                            |
| `TRANSFER_REFERENCE_CONFLICT`           | Misma referencia fuera de la contraparte legítima: mismo tipo con otros atributos, o tipo opuesto con la misma cuenta. | Revisión; no se descarta ni se crea en silencio.                      |
| `CARD_PAYMENT_NOT_CONFIRMED`            | Pago no confirmado.                                                                                                    | Sin movimiento.                                                       |
| `CARD_PAYMENT_CARD_NOT_FOUND`           | Tarjeta no encontrada.                                                                                                 | Sin movimiento.                                                       |
| `CARD_PAYMENT_CARD_AMBIGUOUS`           | Varias tarjetas coinciden.                                                                                             | Sin movimiento; candidatos.                                           |
| `CARD_PAYMENT_CARD_NOT_CREDIT`          | Tarjeta no es de crédito.                                                                                              | Sin movimiento.                                                       |
| `CARD_PAYMENT_SOURCE_ACCOUNT_NOT_FOUND` | Cuenta de origen no encontrada.                                                                                        | Sin movimiento.                                                       |
| `CARD_PAYMENT_SOURCE_ACCOUNT_AMBIGUOUS` | Varias cuentas de origen.                                                                                              | Sin movimiento; candidatos.                                           |
| `CARD_CURRENCY_MISSING`                 | La tarjeta no tiene saldo en la moneda.                                                                                | Sin movimiento.                                                       |
| `CARD_PAYMENT_POSSIBLE_DUPLICATE`       | Pago parecido sin coincidencia de referencia.                                                                          | Sin movimiento; solo evidencia, porque un candidato único se vincula. |
| `CARD_PAYMENT_NOT_IMPORTED`             | La operación de dos patas no se pudo escribir.                                                                         | Sin movimiento; revisión.                                             |
| `CARD_PAYMENT_REFERENCE_CONFLICT`       | Misma referencia con atributos distintos.                                                                              | Revisión; no se descarta ni se crea en silencio.                      |
| `CARD_PAYMENT_RECONCILIATION_AMBIGUOUS` | Varios pagos parecidos.                                                                                                | Sin movimiento; candidatos.                                           |
| `REVERSAL_ORIGINAL_NOT_FOUND`           | No hay original sin referencia explícita.                                                                              | Sin movimiento.                                                       |
| `REVERSAL_REFERENCE_NOT_FOUND`          | Referencia explícita sin original elegible.                                                                            | Revisión; no usa candidato por heurística.                            |
| `REVERSAL_COMMERCE_MISSING`             | Reverso sin comercio para candidatos.                                                                                  | Revisión; no auto-vincula.                                            |
| `REVERSAL_ORIGINAL_AMBIGUOUS`           | Varios originales posibles.                                                                                            | Sin movimiento; candidatos.                                           |
| `REVERSAL_ORIGINAL_NOT_CONFIRMED`       | El original no está confirmado.                                                                                        | Sin movimiento.                                                       |
| `REVERSAL_TARGET_NOT_SUPPORTED`         | El original es transferencia o pago de tarjeta.                                                                        | Sin movimiento por la ruta de compras.                                |
| `REVERSAL_PARTIAL_NOT_SUPPORTED`        | El monto no coincide con el original.                                                                                  | Sin movimiento.                                                       |

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
- Si la referencia apunta a una pata de transferencia, a un pago de tarjeta o a un original ya `REVERSED`, no se busca un candidato alternativo: se revisa o se devuelve `ALREADY_APPLIED`.
- Si la referencia existe y no encuentra original, el caso queda en revisión `REVERSAL_REFERENCE_NOT_FOUND`; no se usa un candidato por heurística. La opción de continuar por el id de correo o candidatos queda PENDIENTE CONCRETAR y no se implementa como fallback automático.
- Si no hay referencia, se busca por el id de correo y luego por candidatos; el paso usado queda en la evidencia.
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

| Caso                              | Resultado                                                  |
| --------------------------------- | ---------------------------------------------------------- |
| Original no confirmado            | `REVERSAL_ORIGINAL_NOT_CONFIRMED`, revisión.               |
| Original es transferencia o pago  | `REVERSAL_TARGET_NOT_SUPPORTED`, revisión.                 |
| Original ya `REVERSED`            | `ALREADY_APPLIED`, sin segunda compensación.               |
| Referencia explícita sin original | `REVERSAL_REFERENCE_NOT_FOUND`, revisión; no auto-vincula. |
| Sin referencia y sin candidato    | `REVERSAL_ORIGINAL_NOT_FOUND`, revisión.                   |
| Candidato sin comercio            | `REVERSAL_COMMERCE_MISSING`, revisión.                     |
| Varios candidatos                 | `REVERSAL_ORIGINAL_AMBIGUOUS`, revisión.                   |
| Reverso parcial                   | `REVERSAL_PARTIAL_NOT_SUPPORTED`, revisión.                |

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
- No se crea un movimiento nuevo de reverso; el original se marca.
- No se crea `groundTruth` ni una verificación humana por el reverso.

### 6.5 Idempotencia

- Replay de la misma señal: `ALREADY_APPLIED`, sin segunda compensación.
- Segundo reverso con la misma referencia sobre un original ya `REVERSED`: `ALREADY_APPLIED`.
- Segundo reverso sin referencia que no encuentra un candidato vigente porque el original ya está `REVERSED`: revisión `REVERSAL_ORIGINAL_NOT_FOUND`, sin segunda compensación.
- Dos reversos distintos con candidatos distintos: se procesan por separado.
- Un reverso de un reverso no se vincula al original revertido; va a revisión.

## 7. Dedupe y conciliación

- La referencia bancaria no es única. El índice actual `(user_id, external_reference)` no impone unicidad y no se agrega una restricción única.
- Un match de referencia es un candidato, no prueba de duplicado. En una operación de dos patas, las dos comparten `externalReference`; el dedupe se hace a nivel de operación o con referencia más tipo, cuenta, monto y moneda.
- Si la referencia coincide pero los atributos de la operación difieren, el caso va a revisión (`TRANSFER_REFERENCE_CONFLICT` o `CARD_PAYMENT_REFERENCE_CONFLICT`); no se descarta ni se crea en silencio. Queda fuera de esta regla la contraparte legítima de una transferencia: misma referencia, mismo usuario, tipo opuesto y cuenta distinta no es duplicado ni conflicto (sección 3.4).
- En una compra, el dedupe sigue el ADR-003: primero `externalReference`; si falta, mismo destino, monto, moneda, tipo, comercio y fecha dentro de 10 minutos.
- En una transferencia, el fallback sin referencia usa destino, tipo, monto, moneda y fecha dentro de 10 minutos; la referencia compartida por la contraparte no es duplicado.
- En un pago de tarjeta, el fallback incluye pagos manuales sin referencia con tres días de ventana. Un candidato único se vincula como `DUPLICATE` sin crear filas; varios van a `CARD_PAYMENT_RECONCILIATION_AMBIGUOUS`. Sin candidato, el pago confirmado se importa una vez; la opción de la ruta manual queda pendiente.
- No se infiere una referencia que el correo no trae. No se exige una referencia única para resolver el pago.

## 8. Estados del contrato

### 8.1 Acordado

- Transferencia: una pata conocida, emparejamiento pendiente y contraparte no inventada.
- Pago de tarjeta: dos patas `CARD_PAYMENT`, sin gasto, conciliadas con pagos manuales y sin duplicados.
- Recordatorios: no crean movimientos.
- Fecha del correo: solo sugerencia con procedencia; confirmación humana antes de registrar.
- Reverso: referencia primero; sin referencia, id de correo y candidatos; candidato único válido automático, cero o varios a revisión. Una referencia explícita sin original queda en revisión y su fallback está pendiente.
- Reversos: no se exige confirmación universal.
- Referencia compartida: dos patas de la misma operación no son duplicado ni conflicto.
- Referencia bancaria: no es obligatoria ni única; un match es candidato y un conflicto de atributos va a revisión. La contraparte legítima (tipo opuesto y cuenta distinta) no es duplicado ni conflicto. El fallback y la conciliación manual cubren su ausencia.

### 8.2 Pendiente concretar

- Referencia explícita de reverso sin original: revisión; la opción de continuar por el id de correo o candidatos queda pendiente y no se implementa como fallback automático.
- Ventana temporal con la referencia presente: **decidida**. Siete días para dos correos que comparten referencia y para el pago de tarjeta importado (decisión del owner del 2026-11-11, registrada en el issue #335). Sin referencia, el pago de tarjeta usa tres días, también decididos en el issue #335; el fallback del ADR-003 conserva sus ±10 minutos para compras y transferencias.
- Ruta manual ante un pago parecido: opciones (A) bloqueo con `duplicateAcknowledged`, (B) aviso sin bloqueo, (C) ruta intacta. Cambia la API y el objetivo de no duplicar; no está aprobada.
- Comercio ausente en candidatos de reverso: revisión; el ADR-003 lo exige y no se auto-vincula solo por monto, moneda y fecha.
- Reverso de transferencias y de pagos de tarjeta: ruta específica fuera de estos cuatro issues; por ahora `REVERSAL_TARGET_NOT_SUPPORTED`.
- Reverso parcial: fuera de esta fase; por ahora `REVERSAL_PARTIAL_NOT_SUPPORTED`.
- Texto visible y ubicación de los motivos en la UI: los códigos son estables; el texto puede cambiar.
- Piloto BHD: bloqueado por CTR-02 y por la implementación de estos contratos; no se inicia aquí.

### 8.3 Implementado y probado

| Flujo                          | Estado                              | Evidencia                                                                                                                |
| ------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Pago de tarjeta (#335)         | `IMPLEMENTADO-PROBADO` en `0c9b130` | Pruebas unitarias de la conciliación, del consumidor y del caso de uso; integración con dos patas, saldos y referencias. |
| Transferencia (#334)           | `IMPLEMENTADO-PROBADO` en `461b22b` | Una pata conocida, `legRole`, dedupe y contraparte legítima; el emparejamiento se invoca tras importar la pata.          |
| Pistas del clasificador (#343) | `IMPLEMENTADO-PROBADO`              | Fecha del encabezado como sugerencia con fuente; se conserva ausente la fecha de operación y se propaga a la señal.      |
| Datos faltantes (#337)         | `PARCIALMENTE IMPLEMENTADO`         | La sugerencia llega desde el clasificador; la fila de revisión y la confirmación del consumidor siguen pendientes.       |
| Reversos (#336)                | `NO_IMPLEMENTADO`                   | Sin cambios.                                                                                                             |

Los casos `T-TRA`, `T-TAR`, `T-DAT` y `T-REV` siguen propuestos y no ejecutados como paquete completo. La QA sintética existente y CTR-02 se conservan en `temp/pr331-test-reports/` y no certifican estos cambios.

## 9. Evidencia actual y brechas

| Afirmación del contrato                         | Código actual                                                                                                                                                                       | Estado                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| La transferencia resuelve una cuenta propia     | `resolveTransferAccount` compara `accountNumberLast4` con cuentas activas del usuario; no usa tarjeta, CASH ni cuenta por defecto (`resolve-transfer-import.ts`).                   | `IMPLEMENTADO` (PR #340)    |
| La transferencia crea una sola pata con rol     | `executeUnpairedTransfer` crea el grupo y el repositorio persiste `legRole` (`prisma-ledger-import.repository.ts`).                                                                 | `IMPLEMENTADO` (PR #340)    |
| El emparejamiento usa 3 días y 50/2 %           | `match-imported-transfers.ts` define la ventana (3 días, o 7 con la misma referencia) y la tolerancia; `pickTransferMatch` exige un candidato único y devuelve los competidores.    | `VERIFICADO` (`461b22b`)    |
| La referencia compartida no descarta la pata    | `classifyTransferImport` compara referencia, tipo, cuenta, monto, moneda y fecha; la contraparte legítima se importa (`resolve-transfer-import.ts`).                                | `IMPLEMENTADO` (PR #340)    |
| El pago de tarjeta reutiliza dos patas          | El correo llama `ImportCardPaymentUseCase`, que decide y escribe con `createImportedCardPayment`: dos patas `CARD_PAYMENT`, `source EMAIL`, sin categoría, con bloqueo por usuario. | `VERIFICADO` (`0c9b130`)    |
| El clasificador emite las pistas                | Esquema y prompt con `accountNumberLast4`, `CARD_PAYMENT`, fecha sugerida con procedencia y `reverseOfEmailMessageId`; aplica la fecha recibida fuera del modelo.                   | `IMPLEMENTADO` (PR #343)    |
| La fecha del encabezado es solo sugerencia      | La clasificación completa `suggestedTransactionDate` con `EMAIL_HEADER` desde `receivedAt` y conserva `transactionDate` ausente; la fila y confirmación siguen pendientes.          | `PARCIALMENTE IMPLEMENTADO` |
| El reverso sigue la cadena del ADR-003          | El consumidor solo busca por referencia y cae a `bankReference` (`finance-signal-consumer.ts:440-470`); el helper de candidatos no se llama.                                        | `NO_IMPLEMENTADO`           |
| El reverso filtra tipo, transferencia y tarjeta | `findCandidatesForReverse` filtra usuario, estado, moneda, monto y ±14 días; no filtra tipo ni grupo (`prisma-ledger-read.repository.ts:338-366`).                                  | `PARCIALMENTE_IMPLEMENTADO` |
| La pata de tarjeta no repite `importReference`  | `createCardPayment` escribe `importReference` solo en la pata `SOURCE`; la prueba de integración lo comprueba.                                                                      | `VERIFICADO` (`0c9b130`)    |

La tolerancia de 50 o 2 % y la ventana de 10 minutos del ADR son comportamiento existente. La ventana de emparejamiento es de 3 días, y de 7 cuando las dos patas comparten referencia, por decisión del owner. La ventana de ±14 días del reverso viene del ADR-003 y no se cambia por inferencia.

## 10. Pruebas

Los casos propuestos viven en el paquete local de revisión y se resumen en los issues:

- `T-TRA`: una pata, cuenta ambigua, solo tarjeta, referencia compartida, conflicto de referencia en operaciones distintas, emparejamiento único y ambiguo, replay, aislamiento y estado pendiente. El emparejamiento tiene pruebas de unidad de la ventana (3 y 7 días), del consumidor (llamada, ausencia y evidencia de ambigüedad) y de integración (dos patas en un solo grupo, sin categoría).
- `T-TAR`: dos patas, saldos, estado de cuenta, pago manual con y sin referencia, referencia conflictiva, recordatorio, tarjeta o cuenta inválida, replay, dos pagos legítimos, aislamiento y opciones manuales pendientes.
- `T-DAT`: monto, moneda, fecha, sugerencia, confirmación, instrumento, replay, ausencia de verificación implícita y aislamiento.
- `T-REV`: referencia, correo, candidato único, cero, varios, referencia explícita sin match, comercio ausente, transferencia, pago de tarjeta, parcial, otro usuario, fuera de ventana y replay.

Un caso solo se marca PASS cuando el contrato está implementado y el caso se ejecutó completo en el SHA exacto. Un caso propuesto no es una prueba ejecutada.

## 11. Selección acotada de muestra (piloto BHD)

- Estado: `IMPLEMENTADO-PROBADO` solo para esta operación. Los cuatro flujos de
  las secciones 3 a 6 siguen `NO_IMPLEMENTADO`.
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

| Campo                             | Contenido                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `messageId`                       | Id del correo pedido.                                                                        |
| `status`                          | `INCLUDED` o `NOT_FOUND`.                                                                    |
| `fromAddress`, `fromDomain`       | Remitente persistido.                                                                        |
| `receivedAt`                      | Fecha de recepción del correo, no la de operación.                                           |
| `classification`                  | Tipo, confianza, método, clase de movimiento, monto, moneda, fecha de operación y dirección. |
| `classificationUnavailableReason` | Motivo cuando la clasificación no se pudo calcular.                                          |
| `hints`                           | Referencia bancaria, comercio y `last4` observados.                                          |
| `signal.published`                | Si el correo publicaría una señal `FINANCE.TRANSACTION_DETECTED`.                            |
| `signal.reason`                   | Motivo cuando no publica.                                                                    |
| `prediction`                      | Resultado previsto y, si aplica, el movimiento que crearía.                                  |
| `execution`                       | Solo al ejecutar: resultado aplicado y id del movimiento.                                    |

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
- La operación no implementa las secciones 3 a 6: si el correo necesita
  transferencia con cuenta, pago de tarjeta o reverso, el resultado depende de lo
  que esas secciones todavía no resuelven.
