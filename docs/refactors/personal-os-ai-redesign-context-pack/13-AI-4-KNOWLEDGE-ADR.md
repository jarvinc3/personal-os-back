# 13 - ADR AI-4: motor de conocimiento con alcance GLOBAL y USER

- Estado: aceptado (2026-10-25)
- Issue: #207
- Decisiones de Jarvin: [comentario en #207](https://github.com/jarvinc3/personal-os-back/issues/207#issuecomment-6406508577)

## Contexto

AI-3 (#206, #217) dejó en `develop` el dataset `EMAIL_V1`, los runs con watermark y las verificaciones humanas append-only por mensaje. AI-4 deriva conocimiento reconstruible a partir de esa evidencia. Este ADR fija las reglas que el roadmap (`07`), el modelo de datos (`09`) y las decisiones de `01-IMPLEMENTATION-DECISIONS.md` dejaron abiertas.

## Decisiones de Jarvin

1. Las 4 verificaciones de QA del 25/10 (rol ADMIN) cuentan como evidencia real. HOLDOUT siempre queda fuera de la proyección.
2. El reinicio de correo usa lápidas, no borrado físico (append-only).
3. La clave de plantilla V1 es el dominio del remitente + el asunto normalizado, sin números, fechas ni montos.
4. No hay un segundo usuario QA: la promoción GLOBAL se prueba con datos de ejemplo en e2e.
5. La UI de AI-4 va en un issue web aparte, que empieza cuando el back esté listo.
6. Exportación en JSON. Borrado inmediato con lápidas, sin periodo de gracia.
7. El aviso de privacidad del opt-out es requisito antes de activar la promoción GLOBAL en producción. No bloquea `develop`.

## Reglas

### De verificación a `knowledgeKey`

Cada verificación de mensaje genera hasta tres claves, calculadas con funciones puras y versionadas (`normalizerVersion`):

- `EMAIL_SENDER`: dirección del remitente en minúsculas, sin `+alias` y sin el nombre visible.
- `EMAIL_DOMAIN`: dominio registrable del remitente, en minúsculas (`alerts.bank.com` → `bank.com`).
- `EMAIL_TEMPLATE`: `dominio + "|" + asunto normalizado`. El asunto se pasa a minúsculas, se le quitan los acentos y los prefijos `re:`/`fwd:`, y los números, fechas, montos y monedas se reemplazan por marcadores (`<n>`, `<fecha>`, `<monto>`); al final se colapsan los espacios.

La clave de remitente solo existe en USER. GLOBAL solo admite `EMAIL_DOMAIN` y `EMAIL_TEMPLATE`, con un payload estructural (tipo semántico, rutas y `transaction.kind`), sin montos, last4, comercio ni referencia.

### Conflictos y peso de `REJECTED`

- Por mensaje vale la verificación de mayor `sequence`. Las anteriores se conservan como historial.
- En USER, gana la verificación vigente más reciente del propio usuario, sin votación. En GLOBAL, por clave se agregan las verificaciones vigentes de sus mensajes y gana la etiqueta con más mensajes. Si hay empate, si la ganadora no llega a 2/3 de los votos o si la apoyan menos de AI_GLOBAL_MIN_CONTRIBUTORS colaboradores distintos (variable de entorno, 3 por defecto y 1 en develop para QA), el ítem queda en REVIEW_REQUIRED y no se usa automáticamente.
- Decisión del owner (2026-10-27): una etiqueta `SECURITY_ALERT` nunca se auto-promueve. Aunque cumpla el umbral y el mínimo de colaboradores, queda en REVIEW_REQUIRED para revisión ADMIN, porque una etiqueta de fraude equivocada afectaría a todos los usuarios.
- Aclaración del owner (2026-10-26): el rol CONTRIBUTOR/ADMIN no salta ni el umbral de 2/3 ni el mínimo de colaboradores. Una plantilla cuyo asunto normalizado pueda contener nombres, comercios o referencias literales se queda en USER y se bloquea para GLOBAL.
- `REJECTED` vale 0 para la etiqueta: excluye el mensaje del cálculo de esa clave, pero suma al conteo de mensajes rechazados para auditoría. Nunca crea conocimiento.
- `CONFIRMED` y `CORRECTED` pesan 1. Las observaciones automáticas de AI-5 pesan menos que cualquier verificación humana y nunca la contradicen.

### Exclusión de HOLDOUT

El proyector descarta toda la evidencia de los ítems con `partition = HOLDOUT` (`isGroundTruth = true`), sea cual sea su rol o veredicto. HOLDOUT solo sirve para evaluar (AI-6).

### Semántica del watermark

- Un run guarda `observationSequence` y `verificationSequence`, más la revisión de consentimiento aplicada.
- La proyección USER solo lee la evidencia de su usuario. La proyección GLOBAL lee la evidencia de los usuarios elegibles. En las dos, el corte es la misma secuencia global.
- El proyector solo lee filas con `sequence <= watermark` ya confirmadas. El watermark se toma en una transacción `REPEATABLE READ`, como el máximo de las secuencias visibles, y la lectura usa la misma instantánea. Una fila que se confirme después con una secuencia menor entra en el run siguiente; el run registra que su corte es por instantánea.

### Rediseño de FK y lápidas

- `AiHumanVerification.user` y `AiKnowledgeObservation.user` dejan de usar `Cascade` y `SetNull`. Pasan a `Restrict`, y el borrado lo hace un servicio explícito.
- El borrado de usuario y el reinicio de correo (decisión 2) usan la misma ruta: se elimina el contenido personal (payload, notas, `sourceId`, `userId`) y se escribe una lápida con tipo, clave estructural, versión del normalizador y `contributorTombstone`, que es un identificador aleatorio y no reversible por usuario. No se guarda un hash del `userId`.
- La lápida solo es elegible para GLOBAL si el consentimiento seguía vigente al borrar.

### Registro de consentimiento

Se agrega `AiConsentEvent`, append-only: `sequence`, `userId` o lápida, `contributeToGlobalKnowledge`, `reason` y `createdAt`. `UserAiSettings` queda como vista del último evento. Cada cambio escribe un evento, y la revisión de consentimiento de un run es el `sequence` máximo aplicado. Revocar el consentimiento pausa GLOBAL y dispara el rebuild al guardar el cambio; si el rebuild falla, GLOBAL sigue en revisión. El borrado no crea eventos que reactiven un consentimiento revocado.

### Campos de reproducción del run

`AiAnalysisRun` agrega `consentRevision`, `reproductionStatus` (`COMPLETE | INCOMPLETE`) y `missingEvidence` (conteos por tipo). Un run `INCOMPLETE` no participa en comparaciones de evidencia equivalente.

### Versiones

`projectorVersion`, `policyVersion`, `sanitizerVersion` y `normalizerVersion` salen de constantes exportadas por el proyector, la política y el saneador. Los literales que hoy están en `ai-evidence.service.ts` se reemplazan por esas constantes.

### Protección contra realimentación

El proyector ignora las observaciones cuyo origen sea el propio conocimiento (`inference` que usó un `AiKnowledge`, con una marca `derivedFromKnowledgeIds`). La confianza de un modelo nunca promueve por sí sola.

### Rol registrado al verificar

Cada verificación conserva el `verifierRole` del momento, no el rol actual. Cambiar después el rol de un CONTRIBUTOR no modifica retroactivamente sus votos; tampoco le da un atajo para promover GLOBAL. Para invalidar una promoción, un ADMIN registra una reversión explícita.

## Plan de implementación (Codex, rama `refactor/ai-4` en `temp`)

1. Cerrar #217 y #206 con el CI en verde.
2. Mergear este ADR.
3. Hacer la migración `ai_knowledge`: `AiKnowledge`, los enums de scope, tipo y estado, los índices únicos parciales, el CHECK de `userId`, `AiConsentEvent`, los campos de reproducción del run, `contributorTombstone` y el cambio de FK a `Restrict`.
4. Escribir los schemas Zod de payload por `knowledgeType`, los normalizadores de clave y el saneador GLOBAL, con fixtures adversariales.
5. Hacer el proyector puro y determinista: primero USER y luego GLOBAL, con la exclusión de HOLDOUT, la de evidencia sin consentimiento y la protección contra realimentación.
6. Implementar la política de promoción (2/3 y al menos AI_GLOBAL_MIN_CONTRIBUTORS colaboradores distintos, configurable por entorno con 3 por defecto y 1 en develop sin excepción por rol), la degradación a REVIEW_REQUIRED y la reversión por ADMIN.
7. Hacer el rebuild completo, el test de equivalencia y el marcado `INCOMPLETE`.
8. Hacer la exportación JSON, el borrado inmediato con lápidas y la migración del reinicio de correo a lápidas.
9. Agregar los endpoints de explorador, cola admin, exportación y borrado, con Swagger y e2e de aislamiento, roles y promoción con datos de ejemplo.
10. Actualizar el changelog y la versión, abrir el PR a `develop` con QA, y después abrir el issue web de la UI de AI-4.
