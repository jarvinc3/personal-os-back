# Knowledge Engine (AI-4)

Estado: `VERIFICADO` en código y pruebas de `refactor/ai-4`. Issue #207.

`AiKnowledge` es una proyección reconstruible. Las fuentes son observaciones y verificaciones humanas con secuencias; `AiConsentEvent` registra los cambios de consentimiento. Un rebuild lee los máximos de las tres secuencias y la evidencia confirmada bajo una sola transacción PostgreSQL `REPEATABLE READ`. El run registra los tres watermarks, versiones y `snapshot: REPEATABLE_READ`.

El proyector genera claves `EMAIL_SENDER`, `EMAIL_DOMAIN` y `EMAIL_TEMPLATE` con `NORMALIZER_VERSION`. El remitente solo aparece en USER. GLOBAL solo admite dominio y plantilla; una plantilla con palabras literales fuera del vocabulario estructural permitido se mantiene en USER para evitar nombres, comercios o referencias en la clave compartida. El payload GLOBAL se construye por lista permitida: relevancia, tipo semántico, rutas y `transaction.kind`. Se excluyen HOLDOUT, verificaciones rechazadas, usuarios sin consentimiento y observaciones derivadas de conocimiento. `REJECTED` suma a `rejectedMessages` pero no aporta etiqueta. La observación automática puede crear USER `OBSERVED`; no promueve GLOBAL por sí sola.

Por mensaje rige la verificación de mayor secuencia. USER toma la más reciente para cada clave. GLOBAL cuenta un voto por mensaje y etiqueta; la ganadora requiere más votos que cualquier empate, al menos 2/3 del total y el mínimo de colaboradores distintos de `AI_GLOBAL_MIN_CONTRIBUTORS`. El valor por defecto es 1 en `NODE_ENV=development` para QA y 3 en test/production. Sin soporte suficiente, `REVIEW_REQUIRED` no se expone al usuario general. Un ADMIN puede registrar una reversión como verificación append-only, que deja el ítem `BLOCKED`.

El reinicio de correo, el borrado de datos AI y la eliminación de cuenta llaman la misma ruta de anonimización. Se eliminan correos y USER knowledge; las verificaciones y observaciones pierden `userId`, origen, payload y notas. Las lápidas elegibles conservan solo estructura y un `contributorTombstone` aleatorio, compartido entre las filas del usuario borrado para contar colaboradores distintos. HOLDOUT y el consentimiento revocado nunca producen lápidas elegibles. Los runs afectados pasan a `INCOMPLETE` con conteos por tipo en `missingEvidence`; no son aptos para comparación de evidencia equivalente. La exportación JSON omite tokens OAuth.

La proyección se borra y vuelve a crearse dentro de la misma transacción. Los ítems GLOBAL que perdieron toda la evidencia permanecen en `REVIEW_REQUIRED` con contadores de soporte cero. Los índices parciales impiden duplicados por clave y alcance; el CHECK exige `userId` solo en USER.

## Evidencia

- `packages/ai-agent/src/intelligence/knowledge/knowledge-projector.spec.ts`: normalización, saneamiento, determinismo, corrección, umbral, HOLDOUT, consentimiento y realimentación.
- `packages/ai-agent/src/intelligence/knowledge/ai-data-deletion.service.spec.ts`: lápidas elegibles y opt-out.
- `test/ai-agent.e2e-spec.ts`: JWT, aislamiento de rutas, confirmación de borrado y acceso ADMIN.

Contrato HTTP: [knowledge-http.md](../contracts/knowledge-http.md).
