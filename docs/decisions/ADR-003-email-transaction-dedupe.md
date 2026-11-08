# ADR-003: Deduplicación de transacciones importadas por correo

- Estado: `accepted`
- Fecha: 2026-10

## Contexto

El banco puede reenviar el mismo aviso con distinto `gmailMessageId`, y Uber suele cobrar y reversar varias veces. Hoy el único dedup es `(sourceId, gmailMessageId)` en `FinEmailMessage`: dos correos distintos del mismo cobro crean dos transacciones. Además, un aviso de reverso sin cargo original no se persiste y se vuelve a analizar con IA en cada sync.

## Decisión

- El extractor gana `bankReference` (referencia o código de autorización visible en el aviso). Se guarda en `FinTransaction.externalReference` (columna nullable, índice `(user_id, external_reference)`).
- Antes de importar, se descarta el duplicado contra transacciones no terminales (`PENDING` / `CONFIRMED`) del mismo usuario: primero por `externalReference`; si falta, por mismo destino (cuenta o tarjeta), monto, moneda, tipo, comercio y `transactionDate` dentro de ±10 minutos.
- El correo descartado se registra como `SKIPPED_DUPLICATE` con su payload y no crea fila ledger.
- Reverso: el original se resuelve por `reverseOriginalRef`, luego por `reverseOfEmailMessageId`, luego por los candidatos actuales (±14 días, mismo monto/moneda/comercio). Si no aparece, el correo queda `PENDING_REVERSE` con su payload y se reintenta en cada sync. Si el original ya está `REVERSED`, el reverso repetido se registra `SKIPPED_DUPLICATE` y no se reintenta.
- La dedupe solo mira `PENDING` / `CONFIRMED`: un cargo nuevo con la misma referencia que un original ya reversado es legítimo (recobro).

## Aclaración 2026-11-08 — contrato de importación por correo

Esta aclaración no cambia la decisión aceptada. Distingue lo que el código hace hoy de lo que el contrato objetivo exige. El detalle vive en [email-import.md](../modules/finance/contracts/email-import.md).

- **Referencia compartida.** `bankReference` no es única y no se agrega una restricción única. Las dos patas de una transferencia o de un pago de tarjeta comparten `externalReference`; el dedupe de la segunda pata debe considerar tipo y cuenta, o la operación completa, no solo la referencia. Una contraparte con la misma referencia y dirección opuesta no es un duplicado.
- **Fallback de compra.** Se conserva el orden del ADR: primero `externalReference`; si falta, mismo destino, monto, moneda, tipo, comercio y `transactionDate` dentro de ±10 minutos. El comercio forma parte del fallback; no se elimina.
- **Cadena de reverso.** El nombre `reverseOriginalRef` del ADR corresponde al campo `reverseOfBankReference` del clasificador actual. Le sigue `reverseOfEmailMessageId`, el id del correo original, y luego los candidatos de ±14 días con mismo monto, moneda y comercio. El helper `findCandidatesForReverse` existe en `prisma-ledger-read.repository.ts`, pero el consumidor no lo llama: hoy solo busca por referencia y cae a `bankReference` de la propia reversión. El contrato objetivo conecta la cadena completa y elimina ese fallback.
- **Un reverso no exige confirmación universal.** Un candidato único válido se vincula automáticamente. Cero, varios o un candidato no elegible van a revisión. Un original ya `REVERSED` no se compensa dos veces.
- **Valores que no son política nueva.** La ventana de 3 días y la tolerancia de 50 o 2 % pertenecen al emparejamiento actual de transferencias; no son acuerdos de este ADR. La ventana de ±14 días sí es la del ADR y se conserva.

## Alternativas

Unique por hash de contenido; dedup solo por `gmailMessageId`; dedup solo por asunto/cuerpo idéntico; dejar los duplicados a revisión manual.

## Consecuencias

Migración de esquema (columna, índice y dos valores de `FinEmailMessageOutcome`). El prompt y el schema Zod del extractor ganan `bankReference`. Los datos viejos no se backfillean: no hay dedupe retroactivo. El fallback heurístico puede no fusionar reenvíos cuyo `transactionDate` difiera más de 10 minutos. Los reversos pendientes dejan de gastar extracción IA en cada sync.
