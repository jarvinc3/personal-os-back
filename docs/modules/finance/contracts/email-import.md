# Importación por correo: transferencias, pagos, datos faltantes y reversos

- Estado: contrato acordado; `NO_IMPLEMENTADO`.
- Fecha: 2026-11-08.
- Base: `develop` `4dedfa933a5eaf2f249366c678b542eed14a8020`.
- Issues: [#334](https://github.com/jarvinc3/personal-os-back/issues/334), [#335](https://github.com/jarvinc3/personal-os-back/issues/335), [#337](https://github.com/jarvinc3/personal-os-back/issues/337), [#336](https://github.com/jarvinc3/personal-os-back/issues/336).
- Evidencia de la unidad: paquete local de revisión, no versionado; el alcance público vive en los issues.

Este documento fija el contrato objetivo de la importación por correo. No describe comportamiento desplegado. Los casos de prueba propuestos no están ejecutados y no se presentan como aprobados. La revisión de Codex se incorporó al paquete local; este repositorio no acredita una aprobación formal ni un exporte independiente de esa revisión.

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

| Campo                            | Obligatorio                  | Regla                                                                                                                                                              |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kind`                           | Sí                           | `TRANSACTION` o `PENDING`.                                                                                                                                         |
| `movementClass`                  | Sí                           | Lista cerrada; se agrega `CARD_PAYMENT`.                                                                                                                           |
| `direction`                      | Sí                           | `DEBIT`, `CREDIT` o `TRANSFER`.                                                                                                                                    |
| `amount`, `currency`             | Sí                           | Monto positivo y moneda ISO 4217.                                                                                                                                  |
| `transactionDate`                | Sí para importar             | Fecha de operación observada. Si solo hay fecha de encabezado, aplica la sección 5.                                                                                |
| `accountNumberLast4`             | Sí para transferencia y pago | Cuatro dígitos de la cuenta propia. Es la cuenta de origen en un pago de tarjeta. Campo nuevo.                                                                     |
| `last4`                          | Solo tarjeta                 | Cuatro dígitos de la tarjeta. En una transferencia no se usa como cuenta.                                                                                          |
| `bankReference`                  | No                           | Referencia visible del aviso. Se guarda en `externalReference`. No es única y no se exige para importar.                                                           |
| `bankStatusNormalized`           | Sí para confirmar            | `APPROVED`, `COMPLETED` o `POSTED` confirman; `PENDING`, `IN_PROGRESS` o `AUTHORIZED` no importan; `REVERSED`, `REFUNDED` o `CHARGEBACK` van a la ruta de reverso. |
| `suggestedTransactionDate`       | No                           | Fecha que sugiere el correo, por ejemplo la del encabezado. No es la fecha de operación.                                                                           |
| `suggestedTransactionDateSource` | Con la sugerencia            | En esta fase solo `EMAIL_HEADER`; la aporta el parser determinista.                                                                                                |
| `reverseOfBankReference`         | No                           | Referencia del original de un reverso. Equivale al `reverseOriginalRef` del ADR-003.                                                                               |
| `reverseOfEmailMessageId`        | No                           | Id del correo original de un reverso, cuando el mensaje lo permite. Es el `reverseOfEmailMessageId` del ADR-003.                                                   |

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
- fecha dentro de 3 días;
- monto exacto o tolerancia de comisión de 50 o 2 %;
- exactamente un candidato no emparejado.

Si hay exactamente un candidato, se vinculan las dos patas con el mismo `transferGroupId`. Si hay cero o más de uno, no se elige por semejanza: las patas quedan pendientes y se registra `TRANSFER_PAIR_AMBIGUOUS` con evidencia.

La ventana de 3 días y la tolerancia de 50 o 2 % son comportamiento actual del código, no un acuerdo de producto nuevo. Se conservan mientras no exista una decisión explícita que las cambie.

### 3.4 Dedupe

- Replay de la misma señal: `fin_signal_import` existente, `ALREADY_APPLIED`, sin segunda fila.
- Aviso repetido de la misma pata: misma referencia, mismo tipo y misma cuenta, `DUPLICATE`, sin segunda fila.
- Contraparte legítima: misma referencia, tipo opuesto y cuenta distinta, no es duplicado; se importa y puede emparejar.
- Sin referencia: se usa el fallback del ADR-003 por destino, tipo, monto, moneda, comercio y fecha dentro de 10 minutos. Si el candidato es ambiguo, no se crea una segunda pata; se deja la evidencia para revisión.

La referencia compartida no basta para descartar la segunda pata. El dedupe de transferencias debe considerar al menos tipo y cuenta, además de la referencia.

### 3.5 Contabilidad

- Una pata con `transferGroupId` distinto de nulo no cuenta como gasto ni ingreso; solo la pata `FEE` cuenta como gasto.
- Al emparejar, las dos patas siguen excluidas del gasto. No hay gasto doble.
- No se toca presupuesto ni categoría de una pata de transferencia.

### 3.6 Motivos de revisión

Los motivos de transferencia (`TRANSFER_ACCOUNT_MISSING`, `TRANSFER_ACCOUNT_HINT_UNSUPPORTED`, `TRANSFER_ACCOUNT_NOT_FOUND`, `TRANSFER_ACCOUNT_AMBIGUOUS`, `TRANSFER_DIRECTION_AMBIGUOUS`, `TRANSFER_SIDE_MISSING`, `TRANSFER_PAIR_AMBIGUOUS` y `REVERSAL_TARGET_NOT_SUPPORTED`) están en la tabla única de la sección 5.3.

## 4. Pagos de tarjeta confirmados

### 4.1 Alcance y resolución

- Solo un correo que confirma un pago de tarjeta de crédito desde una cuenta propia.
- Solo estados confirmados. Un aviso pendiente, un recordatorio o una fecha próxima no crean movimiento.
- La tarjeta se resuelve por `last4` entre tarjetas activas `CREDIT` del usuario.
- La cuenta de origen se resuelve por `accountNumberLast4` entre cuentas activas del usuario.
- No se usa la cuenta por defecto, la cuenta CASH, el remitente, el comercio ni el nombre para elegir.
- Si falta una pista, hay varias o la tarjeta no es `CREDIT`, la señal queda en revisión.

Los motivos de pago (`CARD_PAYMENT_NOT_CONFIRMED`, `CARD_PAYMENT_CARD_NOT_FOUND`, `CARD_PAYMENT_CARD_AMBIGUOUS`, `CARD_PAYMENT_CARD_NOT_CREDIT`, `CARD_PAYMENT_SOURCE_ACCOUNT_NOT_FOUND`, `CARD_PAYMENT_SOURCE_ACCOUNT_AMBIGUOUS` y `CARD_CURRENCY_MISSING`) están en la tabla única de la sección 5.3.

### 4.2 Operación de dos patas

Se reutiliza la operación de `POST /api/finance/card-payments`, no se crea una compra:

- pata cuenta: `accountId` resuelto, `cardId` nulo, `type CARD_PAYMENT`, `legRole SOURCE`;
- pata tarjeta: `accountId` nulo, `cardId` resuelto, `type CARD_PAYMENT`, `legRole DESTINATION`;
- ambas: mismo `transferGroupId`, `source EMAIL`, `externalReference`, moneda, monto y fecha; `categoryId` nulo; sin presupuesto;
- solo la pata de origen lleva `importReference` de la señal. La pata de tarjeta no lo lleva porque la clave única `(userId, importReference)` no permite repetirlo; `fin_signal_import.transactionId` apunta a la pata de origen.

La cuenta baja y el disponible de la tarjeta sube. El pago no es gasto. El estado de cuenta calcula `paidAmount` y `payments` desde las patas `CARD_PAYMENT` confirmadas, igual que un pago manual; no hay una tabla de conciliación separada.

### 4.3 Conciliación con pagos manuales

La referencia es la primera pista, no un requisito absoluto.

1. Si el correo trae `bankReference`, se busca un pago existente del usuario por esa referencia en cualquier pata `CARD_PAYMENT`. La comparación es a nivel de operación o grupo, porque las dos patas comparten la referencia.
2. Si no hay coincidencia por referencia, o el correo no trae referencia, se busca un pago parecido por misma cuenta de origen, misma tarjeta, mismo monto, misma moneda y fecha dentro de la ventana de dedupe del ADR-003. La búsqueda incluye pagos manuales sin referencia.
3. Si hay exactamente un candidato parecido, no se crea un duplicado en silencio: el correo queda en revisión con `CARD_PAYMENT_POSSIBLE_DUPLICATE` y el candidato en evidencia.
4. Si hay varios candidatos, queda `CARD_PAYMENT_RECONCILIATION_AMBIGUOUS` con los IDs y no se crea movimiento.
5. Si no hay candidato, el pago confirmado se importa una sola vez. La creación manual posterior con los mismos datos exige confirmación explícita y no duplica por accidente.

La ruta manual conserva la misma operación de dos patas. Se le agrega la misma verificación de conciliación: si existe un pago importado parecido y no se confirma la excepción, responde 409 `CARD_PAYMENT_POSSIBLE_DUPLICATE` con el candidato. La confirmación se expresa con `duplicateAcknowledged: true` en el comando manual; el valor por defecto es `false`. No se crea un endpoint nuevo.

### 4.4 Dedupe e idempotencia

- Replay de la misma señal: `ALREADY_APPLIED`, sin nuevas patas.
- Misma referencia en un pago existente: `DUPLICATE`, sin nuevas patas.
- Dos correos distintos con la misma referencia: un solo pago.
- Dos pagos legítimos con referencias distintas: se permiten aunque compartan cuenta, tarjeta, monto y día.
- Sin referencia y sin candidato: se permite un solo pago; la ruta manual aplica la confirmación de conciliación.
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
- La procedencia `EMAIL_HEADER` la aporta el parser determinista; el modelo no la inventa.
- Si existe `transactionDate`, manda esa fecha. La sugerencia se conserva como evidencia.
- Si solo existe la sugerencia, el motivo es `TRANSACTION_DATE_SUGGESTED`. La cola y el detalle muestran la fecha y su procedencia.
- La persona confirma o corrige con la verificación humana existente: `POST /api/intelligence/messages/:messageId/verifications` con `transaction.transactionDate`.
- Después de la verificación, el reintento usa la fecha confirmada. La sugerencia original queda en el historial de evidencia.
- No se crea una verificación implícita, no se marca `groundTruth` por la sugerencia y no se cambia la partición del dataset.

### 5.3 Motivos estables

Los códigos son estables; el texto visible puede cambiar sin cambiar el código. El número de candidatos y los IDs van en la evidencia, no en el código. Los códigos con sufijo `_n` del código actual son un detalle transitorio que se retira al implementar.

| Código                                  | Condición                                         | Efecto                                     |
| --------------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| `AMOUNT_MISSING`                        | No hay monto.                                     | Sin movimiento.                            |
| `CURRENCY_MISSING`                      | No hay moneda.                                    | Sin movimiento.                            |
| `TRANSACTION_DATE_MISSING`              | No hay fecha de operación ni sugerencia.          | Sin movimiento.                            |
| `TRANSACTION_DATE_SUGGESTED`            | Solo hay fecha de encabezado sugerida.            | Sin movimiento hasta confirmación.         |
| `DIRECTION_MISSING`                     | No se sabe si es débito, crédito o transferencia. | Sin movimiento.                            |
| `NO_LEDGER_TARGET`                      | No hay pista de cuenta o tarjeta.                 | Sin movimiento.                            |
| `AMBIGUOUS_LEDGER_TARGET`               | Varias cuentas o tarjetas coinciden.              | Sin movimiento; candidatos.                |
| `TRANSFER_ACCOUNT_MISSING`              | Transferencia sin cuenta identificada.            | Sin movimiento.                            |
| `TRANSFER_ACCOUNT_HINT_UNSUPPORTED`     | Solo hay last4 de tarjeta en una transferencia.   | Sin movimiento.                            |
| `TRANSFER_ACCOUNT_NOT_FOUND`            | Ninguna cuenta coincide.                          | Sin movimiento.                            |
| `TRANSFER_ACCOUNT_AMBIGUOUS`            | Varias cuentas coinciden.                         | Sin movimiento; candidatos.                |
| `TRANSFER_DIRECTION_AMBIGUOUS`          | La dirección de la transferencia es ambigua.      | Sin movimiento.                            |
| `TRANSFER_SIDE_MISSING`                 | Falta el lado de la transferencia.                | Sin movimiento.                            |
| `TRANSFER_PAIR_AMBIGUOUS`               | Varias patas candidatas al emparejar.             | La pata conocida sigue; no se inventa par. |
| `CARD_PAYMENT_NOT_CONFIRMED`            | Pago no confirmado.                               | Sin movimiento.                            |
| `CARD_PAYMENT_CARD_NOT_FOUND`           | Tarjeta no encontrada.                            | Sin movimiento.                            |
| `CARD_PAYMENT_CARD_AMBIGUOUS`           | Varias tarjetas coinciden.                        | Sin movimiento; candidatos.                |
| `CARD_PAYMENT_CARD_NOT_CREDIT`          | Tarjeta no es de crédito.                         | Sin movimiento.                            |
| `CARD_PAYMENT_SOURCE_ACCOUNT_NOT_FOUND` | Cuenta de origen no encontrada.                   | Sin movimiento.                            |
| `CARD_PAYMENT_SOURCE_ACCOUNT_AMBIGUOUS` | Varias cuentas de origen.                         | Sin movimiento; candidatos.                |
| `CARD_CURRENCY_MISSING`                 | La tarjeta no tiene saldo en la moneda.           | Sin movimiento.                            |
| `CARD_PAYMENT_POSSIBLE_DUPLICATE`       | Pago parecido sin coincidencia de referencia.     | Sin movimiento; candidato en evidencia.    |
| `CARD_PAYMENT_RECONCILIATION_AMBIGUOUS` | Varios pagos parecidos.                           | Sin movimiento; candidatos.                |
| `REVERSAL_ORIGINAL_NOT_FOUND`           | No hay original.                                  | Sin movimiento.                            |
| `REVERSAL_ORIGINAL_AMBIGUOUS`           | Varios originales posibles.                       | Sin movimiento; candidatos.                |
| `REVERSAL_ORIGINAL_NOT_CONFIRMED`       | El original no está confirmado.                   | Sin movimiento.                            |
| `REVERSAL_TARGET_NOT_SUPPORTED`         | El original es transferencia o pago de tarjeta.   | Sin movimiento por la ruta de compras.     |
| `REVERSAL_PARTIAL_NOT_SUPPORTED`        | El monto no coincide con el original.             | Sin movimiento.                            |

## 6. Reversos

### 6.1 Cadena de resolución

El ADR-003 define tres pasos. El contrato los conserva en ese orden:

| Paso | Nombre en el ADR          | Campo o dato actual        | Regla                                                                      |
| ---- | ------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| 1    | `reverseOriginalRef`      | `reverseOfBankReference`   | Referencia exacta del original. No se usa `bankReference` de la reversión. |
| 2    | `reverseOfEmailMessageId` | id del correo original     | Se busca el original por el id del mensaje, cuando está disponible.        |
| 3    | candidatos                | `findCandidatesForReverse` | ±14 días, mismo monto, moneda y comercio; solo si hay un único válido.     |

Reglas de la cadena:

- La referencia es primero. Si encuentra un original elegible, se revierte ese original aunque existan otros candidatos por monto y fecha.
- Si la referencia apunta a una pata de transferencia, a un pago de tarjeta o a un original ya `REVERSED`, no se busca un candidato alternativo: se revisa o se devuelve `ALREADY_APPLIED`.
- Si la referencia no encuentra original, se registra el paso y se continúa con el id de correo y luego con los candidatos. El paso usado queda en la evidencia.
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

| Caso                                  | Resultado                                    |
| ------------------------------------- | -------------------------------------------- |
| Original no confirmado                | `REVERSAL_ORIGINAL_NOT_CONFIRMED`, revisión. |
| Original es transferencia o pago      | `REVERSAL_TARGET_NOT_SUPPORTED`, revisión.   |
| Original ya `REVERSED`                | `ALREADY_APPLIED`, sin segunda compensación. |
| Original no encontrado tras la cadena | `REVERSAL_ORIGINAL_NOT_FOUND`, revisión.     |
| Varios candidatos                     | `REVERSAL_ORIGINAL_AMBIGUOUS`, revisión.     |
| Reverso parcial                       | `REVERSAL_PARTIAL_NOT_SUPPORTED`, revisión.  |

### 6.3 Candidatos

Solo cuando la referencia y el id de correo no resolvieron un original:

- mismo usuario;
- `type DEBIT`;
- `status CONFIRMED`;
- `transferGroupId` nulo;
- no `CARD_PAYMENT`;
- monto exacto al aviso de reverso;
- misma moneda;
- fecha de la transacción dentro de ±14 días de la fecha del reverso;
- comercio como criterio del ADR-003 cuando está disponible;
- no `REVERSED`.

El comercio filtra candidatos cuando existe, pero no desempata entre varios: la unicidad sigue siendo obligatoria. No se usa remitente ni semejanza de texto para elegir.

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
- Segundo reverso por candidato que encuentra el mismo original ya `REVERSED`: `ALREADY_APPLIED`.
- Dos reversos distintos con candidatos distintos: se procesan por separado.
- Un reverso de un reverso no se vincula al original revertido; va a revisión.

## 7. Dedupe y conciliación

- La referencia bancaria no es única. El índice actual `(user_id, external_reference)` no impone unicidad y no se agrega una restricción única.
- En una operación de dos patas, las dos comparten `externalReference`. El dedupe se hace a nivel de operación o con referencia más tipo y cuenta; no se descarta la segunda pata por compartir la referencia.
- En una compra, el dedupe sigue el ADR-003: primero `externalReference`; si falta, mismo destino, monto, moneda, tipo, comercio y fecha dentro de 10 minutos.
- En una transferencia, el fallback sin referencia usa destino, tipo, monto, moneda y fecha dentro de 10 minutos; la referencia compartida por la contraparte no es duplicado.
- En un pago de tarjeta, el fallback incluye pagos manuales sin referencia. Un candidato único va a revisión; varios también. Sin candidato, el pago confirmado se importa una vez y la creación manual posterior exige confirmación.
- No se infiere una referencia que el correo no trae. No se exige una referencia única para resolver el pago.

## 8. Estados del contrato

### 8.1 Acordado

- Transferencia: una pata conocida, emparejamiento pendiente y contraparte no inventada.
- Pago de tarjeta: dos patas `CARD_PAYMENT`, sin gasto, conciliadas con pagos manuales y sin duplicados.
- Recordatorios: no crean movimientos.
- Fecha del correo: solo sugerencia con procedencia; confirmación humana antes de registrar.
- Reverso: referencia primero, cadena del ADR-003, candidato único válido automático, cero o varios a revisión.
- Reversos: no se exige confirmación universal.
- Referencia compartida: dos patas de la misma operación no son duplicado.
- Referencia bancaria: no es obligatoria ni única; el fallback y la conciliación manual cubren su ausencia.

### 8.2 Pendiente concretar

- Reverso de transferencias y de pagos de tarjeta: ruta específica fuera de estos cuatro issues; por ahora `REVERSAL_TARGET_NOT_SUPPORTED`.
- Reverso parcial: fuera de esta fase; por ahora `REVERSAL_PARTIAL_NOT_SUPPORTED`.
- Texto visible y ubicación de los motivos en la UI: los códigos son estables; el texto puede cambiar.
- Piloto BHD: bloqueado por CTR-02 y por la implementación de estos contratos; no se inicia aquí.

### 8.3 Implementado y probado

Ninguno de los cuatro flujos está implementado con este contrato. Los casos `T-TRA`, `T-TAR`, `T-DAT` y `T-REV` son propuestos y no ejecutados. La QA sintética existente y CTR-02 se conservan en `temp/pr331-test-reports/` y no certifican estos cambios.

## 9. Evidencia actual y brechas

| Afirmación del contrato                         | Código actual                                                                                                                                      | Estado                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| La transferencia resuelve una cuenta propia     | El consumidor pasa `accountNumberHint: null` y usa `last4` como tarjeta (`finance-signal-consumer.ts:178-205`).                                    | `NO_IMPLEMENTADO`            |
| La transferencia crea una sola pata con rol     | `executeUnpairedTransfer` crea el grupo, pero `createImportedTransaction` no fija `legRole` (`prisma-ledger-import.repository.ts:57-95`).          | `PARCIALMENTE_IMPLEMENTADO`  |
| El emparejamiento usa 3 días y 50/2 %           | `match-imported-transfers.ts:23-25` define la ventana y la tolerancia; `pickTransferMatch` exige un candidato único.                               | `VERIFICADO` (código actual) |
| La referencia compartida no descarta la pata    | `findDedupeCandidate` busca por `externalReference` sin tipo ni cuenta (`prisma-ledger-read.repository.ts:407-440`).                               | `CONTRADICE_CODIGO`          |
| El pago de tarjeta reutiliza dos patas          | La ruta manual existe (`create-card-payment.use-case.ts`, `prisma-ledger-write.repository.ts:413-524`); el correo no tiene ruta.                   | `NO_IMPLEMENTADO`            |
| La fecha del encabezado es solo sugerencia      | El esquema de clasificación no tiene `suggestedTransactionDate` ni procedencia (`email-classification.util.ts:12-66`).                             | `NO_IMPLEMENTADO`            |
| El reverso sigue la cadena del ADR-003          | El consumidor solo busca por referencia y cae a `bankReference` (`finance-signal-consumer.ts:440-470`); el helper de candidatos no se llama.       | `NO_IMPLEMENTADO`            |
| El reverso filtra tipo, transferencia y tarjeta | `findCandidatesForReverse` filtra usuario, estado, moneda, monto y ±14 días; no filtra tipo ni grupo (`prisma-ledger-read.repository.ts:338-366`). | `PARCIALMENTE_IMPLEMENTADO`  |
| La pata de tarjeta no repite `importReference`  | La clave única `(userId, importReference)` existe (`schema.prisma:811`); la ruta de correo no está implementada.                                   | `NO_IMPLEMENTADO`            |

La ventana de 3 días, la tolerancia de 50 o 2 % y la ventana de 10 minutos del ADR son comportamiento existente, no acuerdos nuevos. La ventana de ±14 días del reverso viene del ADR-003 y no se cambia por inferencia.

## 10. Pruebas

Los casos propuestos viven en el paquete local de revisión y se resumen en los issues:

- `T-TRA`: una pata, cuenta ambigua, solo tarjeta, referencia compartida, emparejamiento único y ambiguo, replay, aislamiento y estado pendiente.
- `T-TAR`: dos patas, saldos, estado de cuenta, pago manual con y sin referencia, recordatorio, tarjeta o cuenta inválida, replay, dos pagos legítimos y aislamiento.
- `T-DAT`: monto, moneda, fecha, sugerencia, confirmación, instrumento, replay, ausencia de verificación implícita y aislamiento.
- `T-REV`: referencia, correo, candidato único, cero, varios, transferencia, pago de tarjeta, parcial, otro usuario, fuera de ventana y replay.

Un caso solo se marca PASS cuando el contrato está implementado y el caso se ejecutó completo en el SHA exacto. Un caso propuesto no es una prueba ejecutada.
