# Intelligence — HTTP

Auth: JWT de Supabase (`Authorization: Bearer <token>`). Envelope `{ data, meta }`; `meta` es `{ timestamp, path, requestId? }`. Fechas ISO 8601. Error estándar: `{ statusCode, error, message, code?, details?, requestId, timestamp, path }`. Las rutas de administración se autorizan con el rol guardado en `user_roles`; sin fila, el rol es `USER`.

Las rutas antiguas de chat (`/api/ai/providers`, `/api/ai/chat`, `/api/ai/sessions`) fueron retiradas. Las conversaciones vigentes están en [Conversaciones](#conversaciones-ai-9).

AI-3 (JWT):

| Método | Path                                                                                                                                                                                              | Notas                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/intelligence/dataset`                                                                                                                                                                       | Conteos `TRAIN`, `VALIDATION`, `HOLDOUT` de `EMAIL_V1`, filtrados por cuenta                                                                              |
| GET    | `/api/intelligence/review-queue?partition=...&status=...&semanticType=...&route=...&confidenceMin=...&confidenceMax=...&fromAddress=...&subject=...&dateFrom=...&dateTo=...&order=...&cursor=...` | Cola paginada por cursor con filtros combinables; cada item trae clasificación y última verificación                                                      |
| POST   | `/api/intelligence/messages/:messageId/verifications`                                                                                                                                             | `CONFIRMED`, `CORRECTED` o `REJECTED`; guarda secuencia y marca HOLDOUT como verdad de referencia                                                         |
| GET    | `/api/intelligence/runs`                                                                                                                                                                          | Runs del usuario con configuración, versiones y watermarks de evidencia                                                                                   |
| POST   | `/api/intelligence/runs/evaluate`                                                                                                                                                                 | Crea un run `EVALUATE` sobre la membresía HOLDOUT congelada; calcula métricas por correo sin escribir observaciones ni conocimiento                       |
| POST   | `/api/intelligence/runs/compare`                                                                                                                                                                  | `{ "firstRunId": "…", "secondRunId": "…" }`; declara comparables solo runs completos con dataset, watermark, versiones y configuración iguales            |
| POST   | `/api/intelligence/email/reset`                                                                                                                                                                   | Requiere `{ "confirmed": true }`; vacía el corpus de correo y derivados del usuario, conserva OAuth; 409 `GMAIL_NOT_CONNECTED` o `GMAIL_SYNC_IN_PROGRESS` |
| POST   | `/api/intelligence/email/sync-bhd`                                                                                                                                                                | Solo fuera de producción; sync Gmail acotada a BHD, con ventana y tope; devuelve `found`, `imported`, `skipped` y `nextPageToken`                         |
| GET    | `/api/intelligence/email/usage?days=7`                                                                                                                                                            | Llamadas, tokens y costo por día, hora, banco y tipo; restante de cada tope. `days` de 1 a 30                                                             |
| GET    | `/api/intelligence/review-groups?order=IMPACT&page=1&pageSize=20`                                                                                                                                 | Grupos por impacto: pendientes, remitente nuevo y confianza media ascendente                                                                              |
| POST   | `/api/intelligence/review-groups/verifications`                                                                                                                                                   | Aplica `CONFIRMED` o `CORRECTED` a los pendientes del grupo; `REJECTED` responde 400                                                                      |
| POST   | `/api/intelligence/messages/verifications/batch`                                                                                                                                                  | Verifica atómicamente de 1 a 20 correos seleccionados                                                                                                     |

`GET /api/intelligence/review-queue` acepta estos parámetros. Todos se combinan entre sí y con la paginación, siempre dentro de la cuenta autenticada.

Los runs `EVALUATE` guardan la cantidad y huella SHA-256 de los IDs HOLDOUT congelados junto con los watermarks y versiones. Métricas: `transactionRecall`, `precision`, `deterministicCoverage`, `modelFallbackRate`, `unknownRate`, `truePositive`, `falsePositive` y `falseNegative`. La comparación devuelve deltas solo cuando ambos runs son comparables; repetir la evaluación crea otro run y conserva los anteriores.

| Parámetro                        | Valores                                         | Notas                                                                                      |
| -------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `partition`                      | `TRAIN`, `VALIDATION`, `HOLDOUT`                | Partición del dataset                                                                      |
| `status`                         | `PENDING`, `CONFIRMED`, `CORRECTED`, `REJECTED` | Uno o varios separados por coma o repetidos; sin el parámetro solo se devuelven pendientes |
| `fromAddress`                    | dirección completa                              | Comparación exacta sin distinguir mayúsculas                                               |
| `subject`                        | texto                                           | Se devuelven los asuntos que lo contienen, sin distinguir mayúsculas                       |
| `dateFrom`, `dateTo`             | `AAAA-MM-DD`                                    | Días completos en la zona de `users.timezone`; `dateTo` incluye ese día                    |
| `order`                          | `OLDEST`, `NEWEST`, `IMPACT`                    | Fecha recibida o impacto; por defecto `OLDEST` y el ID desempata                           |
| `cursor`                         | valor opaco de la página anterior               | Reenviar los mismos filtros y el mismo orden                                               |
| `uncertain`                      | `true`                                          | Predicción bajo el umbral personal o sin predicción; HOLDOUT conserva `0.7`                |
| `semanticType`                   | `SEMANTIC_TYPES`                                | Tipo de la última clasificación                                                            |
| `route`                          | `SEMANTIC_ROUTES`                               | Ruta de clasificación                                                                      |
| `confidenceMin`, `confidenceMax` | número entre `0` y `1`                          | Límites inclusivos; el mínimo no puede superar el máximo                                   |

El estado de un correo es el de su última verificación; sin verificación es `PENDING`. Un pendiente exige además una clasificación que aún requiera revisión: los correos en `PROCESSED` salen de la cola y de los conteos sin recibir verificación. Esa exclusión afecta solo al estado `PENDING`; con estados combinados, el historial `CORRECTED` o `REJECTED` de mensajes `PROCESSED` se conserva. Con estados verificados, cada item incluye `verification` con el veredicto, las etiquetas guardadas, la nota y la fecha; en pendientes vale `null`. Los conteos por partición cuentan solo pendientes (sin verificación y fuera de `PROCESSED`) y aplican remitente, asunto y fechas; el filtro de partición y el orden no los cambian. Un estado, orden o partición fuera de lista, una fecha que no sea `AAAA-MM-DD` válida o un rango invertido responden 400.

```json
{
  "items": [
    {
      "id": "b3c1...",
      "receivedAt": "2026-10-25T12:00:00.000Z",
      "fromAddress": "notifications@github.com",
      "fromDomain": "github.com",
      "subject": "Nueva actividad en tu cuenta",
      "contentFingerprint": "a1b2...",
      "processingStatus": "INGESTED",
      "partition": "TRAIN",
      "status": "CORRECTED",
      "verification": {
        "verdict": "CORRECTED",
        "labels": {
          "relevance": true,
          "semanticType": "TECH_NOTIFICATION",
          "routes": []
        },
        "notes": "No es un cobro",
        "createdAt": "2026-10-25T12:30:00.000Z"
      }
    }
  ],
  "counts": { "TRAIN": 410, "VALIDATION": 40, "HOLDOUT": 41, "all": 491 },
  "hasMore": true,
  "nextCursor": "eyJrZXk..."
}
```

`GET /api/intelligence/review-groups` pagina por página (`page` desde 1, `pageSize` hasta 100) y devuelve solo grupos con al menos un pendiente. `order=IMPACT` es el único orden y el predeterminado: más pendientes, remitente sin conocimiento `EMAIL_SENDER` estable del usuario, menor confianza media de los pendientes y desempate por remitente/plantilla. Un grupo con `templateFingerprint` nulo reúne los correos de ese remitente sin huella. `sampleMessageIds[i]` es el correo de `sampleSubjects[i]`; un asunto repetido no duplica la muestra y conserva el primer id.

```json
{
  "items": [
    {
      "fromAddress": "notifications@github.com",
      "templateFingerprint": "5c1e...",
      "total": 526,
      "pending": 526,
      "pendingHoldout": 52,
      "sampleSubjects": [
        "Revisión de seguridad de <n>",
        "Nueva actividad en tu cuenta",
        "Aviso de inicio de sesión"
      ],
      "sampleMessageIds": ["b3c1...", "6f2a...", "9d4e..."]
    }
  ],
  "page": 1,
  "pageSize": 20,
  "totalGroups": 12,
  "hasMore": true
}
```

`POST /api/intelligence/review-groups/verifications` recibe la identidad del grupo y las mismas etiquetas que la verificación individual. `OTHER` exige nota y `FIN_TRANSACTION` exige `transaction.kind`. La verificación individual también acepta `movementClass` (con `CARD_PAYMENT`), `accountNumberLast4`, la fecha sugerida con su procedencia y las referencias del original de un reverso; la fecha sugerida y su procedencia van juntas o no van.

```json
{
  "verdict": "CONFIRMED",
  "fromAddress": "notifications@github.com",
  "templateFingerprint": "5c1e...",
  "relevance": true,
  "semanticType": "TECH_NOTIFICATION",
  "routes": []
}
```

```json
{
  "verified": 91,
  "holdoutExcluded": 9,
  "alreadyVerified": 0,
  "requeued": 12
}
```

`verified` son las filas nuevas, una por correo pendiente fuera de HOLDOUT. `holdoutExcluded` son los pendientes HOLDOUT que quedan para revisión individual. `alreadyVerified` son los correos del grupo que ya tenían verificación. `requeued` son los correos ya clasificados de la misma plantilla (mismo remitente y misma huella) que se reclasificaron con la etiqueta verificada, sin verificación humana y fuera de HOLDOUT. Una huella nula no se generaliza. Repetir la petición devuelve `verified: 0` y vuelve a contar los correos que se reclasifican. Un `semanticType`, `routes` o `verdict` fuera de lista responde 400 sin registrar nada, y un grupo de otra cuenta responde 404.

`POST /api/intelligence/messages/:messageId/verifications` devuelve la verificación creada y añade `requeued` con el mismo criterio, tomando como alcance los correos de la misma plantilla del mensaje verificado. Repetir la misma petición (mismo veredicto, etiquetas y nota) reutiliza la última verificación idéntica, no agrega otra fila y reintenta la reclasificación. Si la reclasificación falla, responde 500 después de guardar la verificación; el reintento es seguro.

`POST /api/intelligence/messages/verifications/batch` recibe de 1 a 20 `messageIds` únicos, un veredicto y las etiquetas de la verificación individual. Valida que todos los mensajes pertenezcan a la cuenta antes de escribir y agrega una fila append-only por mensaje en una transacción; una selección con un correo ajeno responde 404 sin escrituras. HOLDOUT explícito queda como `isGroundTruth=true`. Un reintento idéntico no agrega filas y se cuenta en `alreadyVerified`; otra etiqueta crea una nueva secuencia. Después se reclasifica una vez cada plantilla distinta seleccionada con huella no nula; esa reclasificación queda fuera de la transacción y el reintento vuelve a intentarla.

La configuración por usuario se guarda en `PATCH /api/users/me/modules/ai`, dentro de `config.email`: `reviewConfidenceThreshold` acepta un número de `0` a `1` (predeterminado `0.7`) y `acceptVerifiedSenders` un booleano (predeterminado `false`). Afecta clasificación y filtro `uncertain` fuera de HOLDOUT; HOLDOUT mantiene `0.7` y no adopta el autoaceptado por remitente.

`GET /api/intelligence/messages/:messageId` incluye `provenance.observations` y `provenance.verifications` en orden de secuencia.

## AI-4: Knowledge

Todas las rutas requieren JWT. `data` es el objeto o array indicado; `meta` es el envelope común. No hay paginación: ninguna ruta de Knowledge acepta `cursor`, `limit` ni `page`, y un query string enviado se ignora. El explorador, la cola y la exportación devuelven todas las filas que cumplen su filtro, sin recortes por página.

| Método | Ruta                                                     | Rol                      | Request                 | HTTP | `data` en éxito                                             |
| ------ | -------------------------------------------------------- | ------------------------ | ----------------------- | ---- | ----------------------------------------------------------- |
| GET    | `/api/intelligence/knowledge`                            | USER, CONTRIBUTOR, ADMIN | —                       | 200  | `KnowledgeExplorer`                                         |
| GET    | `/api/intelligence/knowledge/admin/queue`                | ADMIN                    | —                       | 200  | `KnowledgeItem[]`                                           |
| POST   | `/api/intelligence/knowledge/admin/rebuild`              | ADMIN                    | sin body                | 201  | `KnowledgeRebuild`                                          |
| POST   | `/api/intelligence/knowledge/admin/:knowledgeId/promote` | ADMIN                    | sin body                | 201  | `KnowledgeItem` GLOBAL en `STABLE`; 404/409                 |
| POST   | `/api/intelligence/knowledge/admin/:knowledgeId/revert`  | ADMIN                    | sin body                | 201  | `KnowledgeItem` GLOBAL en `BLOCKED`; 404 si el id no existe |
| GET    | `/api/intelligence/knowledge/me/export`                  | USER, CONTRIBUTOR, ADMIN | —                       | 200  | `KnowledgeExport` (JSON)                                    |
| DELETE | `/api/intelligence/knowledge/me`                         | USER, CONTRIBUTOR, ADMIN | `{ "confirmed": true }` | 200  | `KnowledgeDeletion`                                         |

### `KnowledgeExplorer`

```json
{
  "personal": ["KnowledgeItem"],
  "global": ["KnowledgeItem"]
}
```

`personal` son las filas `USER` del usuario autenticado, que pueden estar en `OBSERVED` o `STABLE`. `global` solo devuelve filas `GLOBAL` en `STABLE`; `REVIEW_REQUIRED` y `BLOCKED` no se exponen al usuario general. Ambas listas ordenan por `knowledgeType` y después por `knowledgeKey`. La cola ADMIN devuelve todos los estados `GLOBAL` y ordena por estado (orden del enum) y después por `updatedAt` descendente.

### `KnowledgeItem`

| Campo                | Tipo                                                                                             | Notas                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                 | string                                                                                           | UUID estable entre rebuilds mientras exista la misma clave.                                                                                                              |
| `scope`              | `USER` \| `GLOBAL`                                                                               |                                                                                                                                                                          |
| `userId`             | string \| null                                                                                   | Solo en `USER`; `GLOBAL` siempre `null`.                                                                                                                                 |
| `knowledgeType`      | `EMAIL_SENDER` \| `EMAIL_DOMAIN` \| `EMAIL_TEMPLATE` \| `ENTITY` \| `RELATION` \| `USER_MAPPING` | AI-4 solo genera los tres `EMAIL_*`; los otros valores existen en el enum de base de datos.                                                                              |
| `knowledgeKey`       | string                                                                                           | `EMAIL_SENDER`: dirección sin nombre ni `+alias`. `EMAIL_DOMAIN`: dominio registrable. `EMAIL_TEMPLATE`: `dominio\|asunto` normalizado con `<n>`, `<fecha>` y `<monto>`. |
| `state`              | `OBSERVED` \| `STABLE` \| `REVIEW_REQUIRED` \| `BLOCKED`                                         | `OBSERVED` es una observación automática sin verificación humana y solo aparece en `USER`.                                                                               |
| `payload`            | `{ label: KnowledgeLabel }`                                                                      | Ver abajo. `GLOBAL` solo lleva estructura; nunca montos, last4, comercio ni referencia.                                                                                  |
| `messagesSeen`       | number                                                                                           | Mensajes que alimentaron la fila (votos vigentes u observaciones).                                                                                                       |
| `rejectedMessages`   | number                                                                                           | Mensajes rechazados para esa clave; no crean conocimiento.                                                                                                               |
| `distinctUsers`      | number                                                                                           | Colaboradores distintos que votaron la clave en `GLOBAL`; `0` en `USER`.                                                                                                 |
| `humanVerifiedCount` | number                                                                                           | Votos humanos vigentes que alimentaron la fila; `0` en `OBSERVED`.                                                                                                       |
| `promotedBy`         | `AUTO` \| `CONTRIBUTOR` \| `ADMIN` \| null                                                       | El enum admite los tres valores; AI-4 solo escribe `AUTO` en `GLOBAL` `STABLE` y `null` en el resto.                                                                     |
| `projectorVersion`   | string                                                                                           | Constante del proyector.                                                                                                                                                 |
| `policyVersion`      | string                                                                                           | Constante de la política de promoción.                                                                                                                                   |
| `normalizerVersion`  | string                                                                                           | Versión del normalizador de claves.                                                                                                                                      |
| `sanitizerVersion`   | string                                                                                           | Versión del saneador GLOBAL.                                                                                                                                             |
| `firstSeenAt`        | string (ISO 8601)                                                                                |                                                                                                                                                                          |
| `lastSeenAt`         | string (ISO 8601)                                                                                |                                                                                                                                                                          |
| `updatedAt`          | string (ISO 8601)                                                                                |                                                                                                                                                                          |

### `KnowledgeLabel`

| Campo                                        | Tipo                                                                                                                                                                                                                        | USER | GLOBAL |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| `relevance`                                  | boolean                                                                                                                                                                                                                     | sí   | sí     |
| `semanticType`                               | `FIN_TRANSACTION`, `PURCHASE_RECEIPT`, `SUBSCRIPTION_BILLING`, `FIN_STATEMENT_NOTICE`, `FIN_ACCOUNT_NOTICE`, `SECURITY_OTP`, `SECURITY_ALERT`, `TECH_NOTIFICATION`, `JOB`, `CALENDAR_EVENT`, `MARKETING`, `SOCIAL`, `OTHER` | sí   | sí     |
| `routes`                                     | array de `FINANCE`, `SUBSCRIPTIONS`, `CALENDAR`, `SECURITY`                                                                                                                                                                 | sí   | sí     |
| `transaction`                                | object; en GLOBAL solo conserva `kind`                                                                                                                                                                                      | sí   | sí     |
| `transaction.kind`                           | `TRANSACTION`, `PENDING`, `NOT_TRANSACTION`                                                                                                                                                                                 | sí   | sí     |
| `transaction.amount`                         | number positivo                                                                                                                                                                                                             | sí   | no     |
| `transaction.currency`                       | string ISO 4217 de 3 letras                                                                                                                                                                                                 | sí   | no     |
| `transaction.transactionDate`                | string ISO 8601                                                                                                                                                                                                             | sí   | no     |
| `transaction.direction`                      | `DEBIT`, `CREDIT`, `TRANSFER`                                                                                                                                                                                               | sí   | no     |
| `transaction.merchant`                       | string                                                                                                                                                                                                                      | sí   | no     |
| `transaction.bankReference`                  | string                                                                                                                                                                                                                      | sí   | no     |
| `transaction.last4`                          | string de 4 dígitos                                                                                                                                                                                                         | sí   | no     |
| `transaction.accountNumberLast4`             | string de 4 dígitos de la cuenta propia; no es la tarjeta                                                                                                                                                                   | sí   | no     |
| `transaction.movementClass`                  | `PURCHASE`, `INCOME`, `PAYROLL`, `ATM_WITHDRAWAL`, `TRANSFER_OUT`, `TRANSFER_IN`, `CARD_PAYMENT`, `FEE`, `REFUND`, `OTHER`                                                                                                  | sí   | no     |
| `transaction.suggestedTransactionDate`       | string ISO 8601; solo sugerencia, no fecha de operación                                                                                                                                                                     | sí   | no     |
| `transaction.suggestedTransactionDateSource` | `EMAIL_HEADER`; va junto con la fecha sugerida                                                                                                                                                                              | sí   | no     |
| `transaction.reverseOfBankReference`         | string; referencia del movimiento original de un reverso                                                                                                                                                                    | sí   | no     |
| `transaction.reverseOfEmailMessageId`        | string; id del correo original de un reverso                                                                                                                                                                                | sí   | no     |

### `KnowledgeRebuild`

`POST /api/intelligence/knowledge/admin/rebuild` lee los watermarks y todas las filas de evidencia dentro de una sola transacción PostgreSQL `REPEATABLE READ`, borra la proyección y la vuelve a crear. Después registra un `AiAnalysisRun` con `configuration.snapshot = "REPEATABLE_READ"`.

```json
{
  "runId": "uuid",
  "observationSequence": "42",
  "verificationSequence": "42",
  "consentRevision": "7",
  "items": 11
}
```

`observationSequence`, `verificationSequence` y `consentRevision` son `BigInt` y se serializan como strings decimales. `items` es la cantidad de filas proyectadas más las filas `GLOBAL` retenidas sin evidencia.

### `KnowledgeRevert`

`POST /api/intelligence/knowledge/admin/:knowledgeId/revert` no lleva body. Registra una verificación `KNOWLEDGE` con veredicto `REJECTED` y rol `ADMIN`, bloquea solo esa clave y devuelve la fila `GLOBAL` con `state: "BLOCKED"` y `promotedBy: null`. No ejecuta el rebuild completo; el siguiente rebuild conserva la decisión. Responde 404 si el id no existe o no es de alcance `GLOBAL`.

`POST /api/intelligence/knowledge/admin/:knowledgeId/promote` no lleva body. Solo acepta una fila `GLOBAL` en `REVIEW_REQUIRED`; registra una verificación `KNOWLEDGE` con veredicto `CONFIRMED` y rol `ADMIN`, reconstruye la proyección y devuelve la fila con `state: "STABLE"` y `promotedBy: "ADMIN"`. Responde 404 si el id no existe o no es `GLOBAL`, y 409 si la fila ya no está en revisión.

### `KnowledgeExport`

`GET /api/intelligence/knowledge/me/export` devuelve en `data` un JSON con los datos de la cuenta. Las secuencias `BigInt` van como strings decimales; las fechas, en ISO 8601.

| Campo           | Contenido                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `exportedAt`    | string ISO 8601                                                                                                                                                                                                                                                                                                                                                                            |
| `connection`    | `null` o `{ id, provider, emailAddress, isActive, initialSyncCompletedAt, lastSyncedAt, createdAt }`                                                                                                                                                                                                                                                                                       |
| `messages`      | Correos propios: `id`, `userId`, `connectionId`, `providerMessageId`, `providerThreadId`, `receivedAt`, `fromAddress`, `fromDomain`, `subject`, `contentFingerprint`, `templateFingerprint`, `processingStatus`, `createdAt`, `updatedAt` y `content` (`messageId`, `rawBody`, `sanitizedBody`, `canonicalBody`, `snippet`, `retentionExpiresAt`). Los cuerpos ya purgados son `null`.     |
| `datasetItems`  | `{ id, datasetId, userId, sourceType, sourceId, partition, createdAt }`                                                                                                                                                                                                                                                                                                                    |
| `runs`          | `id`, `userId`, `datasetId`, `mode`, `status`, `observationSequence`, `verificationSequence`, `consentRevision`, `reproductionStatus`, `missingEvidence`, `projectorVersion`, `policyVersion`, `pipelineVersion`, `detectorVersion`, `promptVersion`, `schemaVersion`, `configuration`, `metrics`, `error`, `startedAt`, `completedAt`, `createdAt`; las tres secuencias van como strings. |
| `observations`  | `sequence` (string), `runId`, `userId`, `knowledgeType`, `knowledgeKey`, `proposedScope`, `sourceType`, `sourceId`, `inferenceId`, `payload`, `contributorTombstone`, `tombstoneEligible`, `normalizerVersion`, `derivedFromKnowledgeIds`, `weight`, `createdAt`                                                                                                                           |
| `verifications` | `sequence` (string), `userId`, `verifierRole`, `targetType`, `targetId`, `verdict`, `correctedPayload`, `notes`, `structuralKeys`, `structuralPayload`, `contributorTombstone`, `tombstoneEligible`, `normalizerVersion`, `isGroundTruth`, `createdAt`                                                                                                                                     |
| `knowledge`     | Filas `USER` propias (`KnowledgeItem`)                                                                                                                                                                                                                                                                                                                                                     |
| `consent`       | `sequence` (string), `userId`, `contributorTombstone`, `contributeToGlobalKnowledge`, `reason`, `createdAt`                                                                                                                                                                                                                                                                                |
| `settings`      | `null` o `{ userId, contributeToGlobalKnowledge, contributionConsentAt, createdAt, updatedAt }`                                                                                                                                                                                                                                                                                            |
| `inferences`    | `id`, `userId`, `task`, `sourceType`, `sourceId`, `provider`, `model`, `promptVersion`, `schemaVersion`, `inputFingerprint`, `fingerprintVersion`, `status`, `errorCode`, `fallbackCount`, `latencyMs`, `inputTokens`, `outputTokens`, `createdAt`, `expiresAt`                                                                                                                            |

La exportación nunca incluye `accessTokenEncrypted` ni `refreshTokenEncrypted`. Tampoco incluye filas `GLOBAL` ni evidencia anonimizada, propia o de otros usuarios.

### `KnowledgeDeletion`

`DELETE /api/intelligence/knowledge/me` exige el body exacto `{ "confirmed": true }`: el campo `confirmed` debe ser el booleano `true`. Cualquier otro valor, un campo extra o la ausencia del body devuelve 400. El borrado es inmediato, sin periodo de gracia.

```json
{
  "deleted": true,
  "deletedMessages": 128,
  "detachedVerifications": 12,
  "detachedObservations": 40,
  "deletedConversations": 2
}
```

Qué hace en una sola operación:

- Borra los correos, los `datasetItems`, los runs y todas las inferencias del usuario.
- Borra su conocimiento `USER` y reconstruye `GLOBAL`.
- Anonimiza sus verificaciones y observaciones: quita `userId`, `targetId`/`sourceId`, payload y notas. Los eventos de consentimiento anteriores quedan anonimizados con la misma lápida.
- Conserva una lápida solo si el consentimiento estaba vigente al borrar y la clave es segura para `GLOBAL` (`EMAIL_DOMAIN` y plantillas del vocabulario permitido). La lápida lleva `contributorTombstone`, `normalizerVersion`, `structuralKeys` y `structuralPayload` estructurales.
- Revoca el consentimiento y escribe un `AiConsentEvent` con `reason: "USER_DELETED_AI_DATA"`. La revocación se registra después de anonimizar para no borrar la elegibilidad de la lápida.
- Elimina la conexión de Gmail y sus tokens OAuth. El reinicio de correo (`POST /api/intelligence/email/reset`) es la ruta que conserva la conexión.
- Elimina conversaciones del agente y mensajes relacionados. La exportación incluye esas conversaciones antes del borrado.

`deleted` siempre es `true`. `deletedMessages` cuenta los correos eliminados; `detachedVerifications` y `detachedObservations` son las filas anonimizadas, que no se borran físicamente.

### Errores

| HTTP | Cuándo                                                                                                         | `message`                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 400  | Body inválido o sin `confirmed: true` en `DELETE /me`                                                          | `Confirma el borrado de datos AI` o el error de validación |
| 401  | Sin JWT, JWT vencido o inválido                                                                                | `Authentication required`                                  |
| 403  | Rol insuficiente en `admin/queue`, `admin/rebuild`, `admin/:knowledgeId/promote` o `admin/:knowledgeId/revert` | `No tienes permisos para esta operación`                   |
| 404  | `admin/:knowledgeId/promote` o `revert` con un id inexistente o que no es `GLOBAL`                             | `Conocimiento GLOBAL no encontrado`                        |
| 409  | `admin/:knowledgeId/promote` sobre una fila que no está en `REVIEW_REQUIRED`                                   | `Solo se puede promover conocimiento GLOBAL en revisión`   |

### Efectos en endpoints existentes

- `GET /api/intelligence/runs` (array, máximo 50, más reciente primero) añade `consentRevision` (string), `reproductionStatus` (`COMPLETE` o `INCOMPLETE`) y `missingEvidence` (`{ observations, humanVerifications }`). Un run pasa a `INCOMPLETE` cuando se retiró evidencia que cubría su corte; no participa en comparaciones de evidencia equivalente.
- `POST /api/intelligence/email/reset` mantiene `{ "confirmed": true }` y responde `{ connected: true, deletedMessages }` cuando existe la conexión. Anonimiza verificaciones y observaciones antes de vaciar el corpus, conserva la conexión OAuth y reconstruye `GLOBAL`. Devuelve 409 `GMAIL_NOT_CONNECTED` sin conexión y 409 `GMAIL_SYNC_IN_PROGRESS` con un sync activo o esperando cuota.
- `POST /api/intelligence/email/sync-bhd` es una operación de piloto disponible solo fuera de producción. Recibe `{ dateFrom, dateTo, maxMessages?, pageToken? }`, consulta Gmail con `from:bhd.com.do after:… before:…` y un tope de 500 por página, e importa solo los mensajes BHD que aún no están en el corpus. Devuelve `{ connected, query, found, imported, skipped, nextPageToken, estimatedTotal }`; `imported` son los nuevos. No cambia el cursor del bootstrap ni el estado de la sync normal, no usa `/email/reset` y no existe en producción.

### Conexión de Gmail y fecha de importación (#382)

`POST /api/intelligence/email/connect` acepta un cuerpo opcional y devuelve `{ authorizationUrl }`:

| Campo          | Tipo                                    | Efecto                                                                                                                              |
| -------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `period`       | `TODAY`, `LAST_MONTH` o `LAST_3_MONTHS` | Fecha desde la que se importa. `TODAY` es la medianoche UTC; los otros restan meses de calendario (día ajustado al último del mes). |
| `senderFilter` | dominio, por ejemplo `bhd.com.do`       | Limita la importación a ese dominio y sus subdominios.                                                                              |

Sin cuerpo en una conexión nueva se conserva el comportamiento anterior: bootstrap desde `2026-01-01` UTC y sin filtro de remitente, para no romper a la web anterior a #421. En una reconexión, omitir `period` y `senderFilter` conserva los valores guardados; `senderFilter: null` borra el filtro y un período nuevo mueve la fecha de inicio hacia adelante.

La elección viaja en el `state` OAuth firmado y se guarda en la conexión (`import_start_at`, `sender_filter`). `GET /api/intelligence` los devuelve como `connection.importStartAt` y `connection.senderFilter`.

La sincronización los respeta en todas sus fases:

- Bootstrap: consulta Gmail con `after:` de la fecha guardada y `from:` del filtro.
- Recuperación: el `after` es el mayor entre `lastSyncedAt` menos la ventana y la fecha guardada; también lleva `from:`.
- Incremental: el historial de Gmail no acepta consulta, así que el corte y el remitente se aplican antes de guardar el correo; un mensaje anterior a la fecha o de otro remitente no se persiste.
- La sync acotada del piloto BHD cruza su ventana con la fecha guardada: nunca consulta ni descarga correo anterior a ese corte. Usa el dominio más específico entre `bhd.com.do` y el filtro guardado (por ejemplo `alerts.bhd.com.do`); si no se solapan, responde 400 sin consultar Gmail. Cuando la conexión tiene alcance, pre-filtra metadata antes del cuerpo. Si la ventana queda fuera del corte, devuelve todo en cero sin consultar Gmail.

Errores: 400 por un período o un filtro con formato inválido. En una reconexión, `senderFilter: null` borra el filtro guardado; omitirlo conserva el anterior. Cambiar el período en una reconexión no borra correo ya importado; solo cambia el corte hacia adelante.

# Señales de inteligencia (AI-7)

- `GET /api/intelligence/signals`: devuelve las últimas 50 señales del usuario autenticado, cada una con su evidencia.
- `GET /api/intelligence/signals/:signalId`: devuelve una señal propia con evidencia; responde `404` si no existe o pertenece a otro usuario.

La respuesta contiene `type`, `domain`, `status`, `sourceType`, `sourceId`, `payload`, `correlationKey`, `occurredAt`, `detectedAt`, `confidence` y `evidence`. Las señales de correo llevan el candidato clasificado como payload y un enlace a `EMAIL_CLASSIFICATION`; `payload.consumption` registra resultado, motivo, referencias del dominio y fecha de procesamiento. AI-11 crea el movimiento en Finance solo tras una señal válida, con importación idempotente; los candidatos ambiguos quedan en revisión. La evidencia no incluye el cuerpo del correo.

# Conversaciones (AI-9)

Todas las rutas requieren JWT y operan con el `userId` autenticado. Una conversación ajena o inexistente responde 404.

| Método   | Ruta                                                       | Respuesta                                                                                                                                                                          |
| -------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/intelligence/conversations`                          | Acepta opcionalmente contexto de invocación (`route`, `view`/`sheet`, `entityRef` y `filters`) y crea `{ id, title, createdAt, updatedAt }`. Sin contexto mantiene compatibilidad. |
| `GET`    | `/api/intelligence/conversations`                          | Lista conversaciones propias con `messageCount`.                                                                                                                                   |
| `GET`    | `/api/intelligence/conversations/:conversationId`          | Devuelve título, fechas, contexto guardado y mensajes `user`/`assistant` en orden. Oculta llamadas y resultados internos de herramientas.                                          |
| `POST`   | `/api/intelligence/conversations/:conversationId/messages` | Acepta `content` y contexto opcional (`route`, `view`/`sheet`, `entityRef` y `filters`); persiste el mensaje/contexto y devuelve `{ conversationId, answer, provider, model }`.    |
| `DELETE` | `/api/intelligence/conversations/:conversationId`          | Borra la conversación y sus mensajes en cascada; devuelve `{ deleted: true }`.                                                                                                     |

El runtime ofrece herramientas `READ` y `WRITE`. `finance_monthly_summary` recibe `month` en formato `AAAA-MM`, calcula el intervalo con la zona horaria del usuario y usa el analizador financiero del dominio para devolver ingresos, gastos, flujo neto y moneda base confirmados. Los montos son cadenas decimales. Si Finance está desactivado, el runtime entrega un error de capacidad sanitizado al modelo y puede continuar la conversación. Cada `WRITE` requiere política AI-10; el endpoint de mensaje devuelve `actions` con la propuesta, su política, estado y payload para mostrar la confirmación al usuario.

`ai_conversations` y `ai_conversation_messages` son privados por usuario, tienen RLS habilitado y revocan acceso a `anon`, `authenticated` y `PUBLIC`. Los datos completos persisten hasta un borrado explícito del usuario o de la cuenta; no hay purga automática en AI-9. La exportación AI los incluye y la rama de borrado correspondiente es `ai.conversations`.

El resumen interno de conversación se guarda en `ai_conversations.summary`. Solo vuelve al contexto de esa conversación y nunca se proyecta a Knowledge.

# Sugerencias por vista (#358)

Todas las rutas requieren JWT y operan con el `userId` autenticado. La vista se identifica por `route` más `view` o `sheet`, sin filtros ni entidad. La respuesta de la lista es `{ "suggestions": [...] }` y cada sugerencia trae `id`, `label`, `prompt` y `action` (`null` o la propuesta AI-10 con `id`, `actionType`, `targetModule`, `policy`, `status` y `payload`).

| Método   | Ruta                                                           | Respuesta                                                                                                                                                                                                                              |
| -------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/intelligence/view-suggestions?route=<ruta>&view=<vista>` | Sugerencias activas y no descartadas del usuario para esa vista. También acepta `sheet=<sheet>` en lugar de `view`. Si el modelo, el ritmo, el cupo o el presupuesto no están disponibles, devuelve `{ "suggestions": [] }` sin error. |
| `DELETE` | `/api/intelligence/view-suggestions/:suggestionId`             | Descarta la sugerencia propia de forma persistente y cancela su acción pendiente; devuelve `{ "dismissed": true }`. Responde 404 si la sugerencia es de otro usuario o no existe.                                                      |

El descarte es por usuario, vista y sugerencia: no oculta las sugerencias de otra vista ni afecta a otro usuario. El recurso no reutiliza `review-queue`, `knowledge` ni `signals`. Comportamiento y límites: [view-suggestions.md](../capabilities/view-suggestions.md).

# Acciones (AI-10)

| Método | Ruta                                          | Respuesta                                                                                          |
| ------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/intelligence/actions`                   | Hasta 100 acciones propias recientes, sin `userId` ni digest interno.                              |
| `POST` | `/api/intelligence/actions/:actionId/confirm` | Reclama y ejecuta una acción `CONFIRM_REQUIRED`, o informa `ALREADY_CLAIMED` / `ALREADY_EXECUTED`. |
| `POST` | `/api/intelligence/actions/:actionId/cancel`  | Cancela una acción propia `PENDING` con claim atómico.                                             |

Solo la decisión `AUTO_ALLOWED` ejecuta sin confirmación. `CONFIRM_REQUIRED` no muta hasta confirmación. `FORBIDDEN` se audita como `FAILED` y no invoca el dominio. El registry bloquea `WRITE` si no hay una acción propia en `RUNNING` y el hash del payload validado no coincide. Una mutación fallida conserva el código tipado en el resultado; no se reintenta con una confirmación posterior.
