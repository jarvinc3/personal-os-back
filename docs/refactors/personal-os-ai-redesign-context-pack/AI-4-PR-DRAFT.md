# AI-4 — conocimiento USER/GLOBAL reconstruible

Registro del borrador usado para el [PR #229](https://github.com/jarvinc3/personal-os-back/pull/229), ya fusionado en `develop`. El seed de QA llegó en el [PR #232](https://github.com/jarvinc3/personal-os-back/pull/232) y la UI web en [web #327](https://github.com/jarvinc3/personal-os-web/issues/327), ambos cerrados. Quedan la validación manual en DEV y el cierre de #207. La fuente vigente de reglas es el [ADR de AI-4](./13-AI-4-KNOWLEDGE-ADR.md).

## Qué cambia

AI-4 deriva conocimiento reconstruible de la evidencia de AI-3. Agrega `AiKnowledge` con alcance `USER` y `GLOBAL`, `AiConsentEvent`, un proyector puro y determinista, la política de promoción con umbral de 2/3 y mínimo de colaboradores, el rebuild con corte `REPEATABLE READ`, la exportación JSON, el borrado con lápidas y los endpoints de explorador, cola ADMIN y reversión.

## Por qué

`Refs #207`. Implementa AI-4 en el rediseño de inteligencia: el conocimiento compartido solo se publica con evidencia humana suficiente, consentimiento y datos estructurales; el conocimiento personal se puede exportar y borrar sin romper la reproducibilidad de GLOBAL.

## Alcance

- **Base de datos:** migración aditiva `20261101090009_ai_knowledge` con los enums de scope, tipo, estado y promoción, los índices únicos parciales, los CHECK de `userId` y tipo GLOBAL, `AiConsentEvent`, los campos de reproducción del run y `contributorTombstone`. `AiHumanVerification.user` y `AiKnowledgeObservation.user` pasan a `Restrict`.
- **Claves y saneamiento:** normalizador versionado de remitente, dominio registrable y plantilla; payload Zod por tipo; saneador GLOBAL por lista permitida.
- **Proyector y política:** exclusión de HOLDOUT, consentimiento y observaciones derivadas de conocimiento; votos por mensaje; 2/3 y mínimo de colaboradores (`AI_GLOBAL_MIN_CONTRIBUTORS`, 3 por defecto y 1 en development); degradación a `REVIEW_REQUIRED`; reversión ADMIN.
- **Ciclo de datos:** rebuild completo en una transacción `REPEATABLE READ`, exportación JSON, borrado inmediato con lápidas, reinicio de correo y borrado de cuenta por la misma ruta.
- **HTTP:** explorador, cola ADMIN, rebuild, reversión, exportación y borrado. Contrato completo en [contracts/http.md](../../modules/intelligence/contracts/http.md#ai-4-knowledge) y esquemas en Swagger. `swagger-spec.json` regenerado.
- **Pruebas:** unitarias del proyector, la política, el servicio y el borrado; e2e de aislamiento, roles y promoción GLOBAL con datos de ejemplo.

## Contrato para la web (#327)

El issue web consume [contracts/http.md](../../modules/intelligence/contracts/http.md#ai-4-knowledge): rutas, roles, DTOs de request y response, errores y ausencia de paginación. `KnowledgeItem` documenta `payload` por alcance; GLOBAL nunca devuelve montos, last4, comercio ni referencia. La exportación omite tokens OAuth y evidencia anonimizada.

## Comprobaciones

- [x] `pnpm format:check`
- [x] `pnpm lint`
- [x] `pnpm test` — 191 suites, 1273 pruebas
- [x] `pnpm test:e2e` — 9 suites, 153 pruebas
- [x] `pnpm build`
- [x] `pnpm db:validate`
- [x] `pnpm lint:money`
- [x] `swagger-spec.json` regenerado desde el código
- [x] `pnpm test:integration` — ejecutado por el CI del PR
- [x] `pnpm db:migrate:deploy` en DEV; la migración consta como aplicada y el seed DEV se ejecutó dos veces
- [x] `pnpm db:migrate:diff:check` sin drift en CI

## Base de datos

- [x] Migración nueva con timestamp posterior a la última del repo
- [x] Cambio de esquema aplicado y probado en DEV

La migración es aditiva y no borra datos existentes. Los defaults cubren las filas previas; el seed de `AiConsentEvent` toma la vista actual de `UserAiSettings`. El paso de FK a `Restrict` exige que el borrado de usuario pase por el servicio explícito; el evento `USER_ACCOUNT_DELETING` ya está conectado.

## Seguimiento después del merge

- **QA en `develop`:** probar un rebuild ADMIN sobre evidencia real, cola ADMIN, reversión, exportación y borrado. El seed sintético permite probar la UI sin sustituir la prueba de proyección desde evidencia. Las verificaciones ADMIN del 25/10 cuentan como evidencia real (ADR, decisión 1); HOLDOUT nunca entra en la proyección.
- **Aviso de privacidad del opt-out:** publicarlo antes de activar la promoción GLOBAL en producción (ADR, decisión 7). No bloquea `develop`.
- **Productor AI-5:** las observaciones automáticas, su peso menor que cualquier verificación humana y la marca `derivedFromKnowledgeIds` quedan para AI-5. El proyector ya las excluye y nunca las deja contradecir una verificación humana, pero AI-4 no las genera.

## Riesgo

- El rebuild borra y recrea toda la proyección dentro de una transacción; es idempotente y no toca la evidencia. Un fallo revierte la transacción y deja la proyección anterior; el rebuild se puede repetir.
- La promoción GLOBAL depende de `AI_GLOBAL_MIN_CONTRIBUTORS`; en development vale 1 para QA y en test/production 3. Un valor mal configurado en producción cambia cuándo se publica conocimiento compartido.
- El borrado de datos propios revoca el consentimiento y elimina la conexión de Gmail. Es inmediato y sin periodo de gracia; la UI debe confirmar la acción.
- La reversión ADMIN es append-only; no hay endpoint para desbloquear una clave. Para volver a habilitarla hace falta una verificación `KNOWLEDGE` posterior con otro veredicto.
- El normalizador usa una heurística de sufijos públicos de dos niveles, no la lista PSL completa. Cubre el corpus actual; un sufijo poco común podría clasificarse mal.
- `swagger-spec.json` se regenera al arrancar la API en entornos no producción. Si la web consume el archivo estático, debe tomar el de este PR.
