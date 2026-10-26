# Dataset, evidencia y revisión humana (AI-3)

`EMAIL_V1` mantiene una partición `TRAIN`, `VALIDATION` o `HOLDOUT` por mensaje. La asignación usa SHA-256 de `userId:messageId` y rangos 80/10/10; una fila ya creada nunca se reasigna. Los mensajes existentes se incorporan al consultar dataset o cola y los nuevos quedan incorporados al siguiente acceso a esa vista.

Las verificaciones se guardan en `ai_human_verifications` como registros nuevos con secuencia PostgreSQL, rol del verificador leído del backend y vínculo `EMAIL_MESSAGE` al mensaje de la misma cuenta. `CORRECTED` exige al menos una etiqueta y `REJECTED` exige motivo. No hay endpoint de edición ni borrado de una verificación. Si el mensaje pertenece a `HOLDOUT`, la fila guarda `isGroundTruth = true`.

La clasificación humana usa `semanticType` de la lista cerrada `FIN_TRANSACTION`, `PURCHASE_RECEIPT`, `SUBSCRIPTION_BILLING`, `FIN_STATEMENT_NOTICE`, `FIN_ACCOUNT_NOTICE`, `SECURITY_OTP`, `SECURITY_ALERT`, `TECH_NOTIFICATION`, `JOB`, `CALENDAR_EVENT`, `MARKETING`, `SOCIAL`, `OTHER`. `routes` admite una lista sin duplicados de `FINANCE`, `SUBSCRIPTIONS`, `CALENDAR`, `SECURITY`; `[]` significa ningún dominio. `OTHER` requiere nota. `SECURITY_ALERT` no admite `relevance: false` y `SECURITY_OTP` no admite `relevance: true`.

`FIN_TRANSACTION` requiere `transaction.kind` (`TRANSACTION`, `PENDING` o `NOT_TRANSACTION`). `PURCHASE_RECEIPT` y `SUBSCRIPTION_BILLING` admiten `transaction` opcional sin `kind`; los demás tipos no admiten `transaction`. El objeto puede contener `amount` positivo, `currency` ISO 4217, `transactionDate` ISO 8601, `direction` (`DEBIT`, `CREDIT`, `TRANSFER`), `merchant`, `bankReference` y `last4` de cuatro dígitos. El DTO y Swagger comparten los mismos valores enumerados; los valores fuera de lista y las propiedades desconocidas se rechazan antes de escribir evidencia.

Los runs pertenecen a la cuenta y congelan dataset, modo, versiones, configuración y watermarks globales de observaciones, verificaciones y consentimiento en una instantánea `REPEATABLE READ`. Al cerrar un run solo se escriben estado, resultado y fecha de cierre; la configuración queda intacta. Los listados siempre filtran por usuario. Después de borrar evidencia, un run afectado queda `INCOMPLETE` con conteos en `missingEvidence` y no se compara como evidencia equivalente.

## HTTP

- `GET /api/intelligence/dataset`: conteos privados de particiones para la cuenta autenticada.
- `GET /api/intelligence/review-queue?partition=TRAIN|VALIDATION|HOLDOUT&cursor=...`: cola keyset-paginada de mensajes aún no verificados, ordenada por fecha recibida ascendente; devuelve conteos pendientes por partición y total.
- `POST /api/intelligence/messages/:messageId/verifications`: agrega `CONFIRMED`, `CORRECTED` o `REJECTED`, etiquetas rápidas y nota.
- `GET /api/intelligence/runs`: historial de runs del usuario, con versiones, watermarks y configuración capturada.
- `GET /api/intelligence/messages/:messageId`: ahora incluye observaciones y verificaciones de ese mensaje como procedencia.

La cola, el detalle y las verificaciones se consultan con `userId` en cada acceso. La paginación usa `receivedAt` e ID como cursor estable. Los conteos consideran solo mensajes pendientes, y el filtro se conserva al cargar más páginas. Rechazar saca el mensaje de la cola pero conserva su motivo e historial. Esta fase registra evidencia y etiquetas; la proyección de conocimiento se implementa en AI-4 y el análisis de correo en AI-5.
