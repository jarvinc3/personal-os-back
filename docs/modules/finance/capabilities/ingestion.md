# Capacidad: ingestion (Gmail)

`FinEmailConnection` = buzón OAuth unique `(userId, provider, emailAddress)`. `FinEmailSource` = vínculo de un banco a ese buzón: `institutionId` + `bankSenderEmail` (correo From de notificaciones). Unique `(userId, institutionId)`: una institución, un buzón. `bankDomain` se deriva del remitente y queda como fallback de filas viejas. No es destino de ledger.

Destino se resuelve por match único de tarjeta `lastFour` o cuenta única de esa institución; 0 o N → `PENDING_ASSIGNMENT` (sin fila ledger).

Tokens cifrados. Job BullMQ `gmail-sync`. Extractor LLM (`AiEmailTransactionExtractor`) vía `AiCoreModule` (sin `forwardRef`). Sync automático (opt-in `emailSync.automatic`) al ligar un banco, al boot de la API y según `UserModule.config.emailSync.schedule` (intervalo mínimo 15 min u horas fijas en la zona del usuario; default 6 h).

AI-11 consume señales financieras publicadas por AI-7 sin acceso de Finanzas a Gmail. `FinSignalImport` reserva `(userId, signalId)` de forma única; el `importReference` usa el id de señal y la evidencia queda en `aiMetadata` (correo, señal, monto/moneda originales, tasa indicada y evidencia de estado). La tasa contable se resuelve con el servicio FX. Instrumento no identificable, confianza baja y reverso sin original quedan en revisión; las referencias bancarias y el dedupe existente protegen duplicados. Las transferencias se emparejan cuando hay contraparte compatible. Una señal agrupa el candidato de un correo, limitación heredada de AI-5; varias operaciones descritas en un correo no se separan automáticamente.

OAuth autoriza **solo el buzón**. Ligar un banco es `POST /api/finance/email-sync/sources` (exige connection con refresh token). Callback sin `institutionId` en `state` no crea source.

Callback público 302:

- Mobile default: `personal-os://finance/oauth/callback?success=1|false`
- Web: `returnTo` https cuyo origin está en `CORS_ORIGIN`, firmado en `state`. Inválido → deep link móvil (no open redirect).

Ver [operations/gmail-sync.md](../operations/gmail-sync.md).

## Casos reales de RD (BHD, Popular, Qik)

Hay fixtures anonimizados en `packages/finance/test/fixtures/bank-emails/` (un `.html` y un `.json` con `expected` por tipo, más un README por banco) y una prueba por formato en `bank-email-fixtures.spec.ts`.

- Las notificaciones de nómina de Banco Popular no traen monto. El extractor las marca `pending_amount` y el router les pone el monto de la última nómina confirmada de la misma cuenta como sugerencia, con la fecha del correo: el movimiento queda `PENDING` y el usuario solo confirma el monto. Si no hay nómina previa, el correo queda en la cola `PENDING_AMOUNT`; nunca se descarta en silencio.
- La referencia bancaria incluye "Número de confirmación". Ese valor va a `externalReference` y dedupe: los dos correos del mismo pago de servicio de BHD y la copia al beneficiario de una transferencia se descartan como duplicados. Los avisos "enviada" y "en proceso" de Popular comparten cuerpo y deduplican por beneficiario, monto y fecha.
- El recordatorio de pago de tarjeta de BHD (`info@bhd.com.do`, sin cifras) no crea movimiento: emite `finance.card_statement.reminder` y la app muestra un aviso para cargar el corte a mano.
- El `module_config.finance` manda: `fixedIncome` (monto, frecuencia, días y cuenta) es la primera sugerencia para una nómina sin cifra, antes de la nómina anterior; y `emailSync.mode` (`DIRECT` o `PENDING`) decide si lo importado entra confirmado o pendiente de confirmar.
