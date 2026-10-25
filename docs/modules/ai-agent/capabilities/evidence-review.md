# Dataset, evidencia y revisión humana (AI-3)

`EMAIL_V1` mantiene una partición `TRAIN`, `VALIDATION` o `HOLDOUT` por mensaje. La asignación usa SHA-256 de `userId:messageId` y rangos 80/10/10; una fila ya creada nunca se reasigna. Los mensajes existentes se incorporan al consultar dataset o cola y los nuevos quedan incorporados al siguiente acceso a esa vista.

Las verificaciones se guardan en `ai_human_verifications` como registros nuevos con secuencia PostgreSQL, rol del verificador leído del backend y vínculo `EMAIL_MESSAGE` al mensaje de la misma cuenta. `CORRECTED` exige al menos una etiqueta y `REJECTED` exige motivo. No hay endpoint de edición ni borrado de una verificación. Si el mensaje pertenece a `HOLDOUT`, la fila guarda `isGroundTruth = true`.

Los runs pertenecen a la cuenta y congelan dataset, modo, versiones, configuración y watermarks globales de observaciones y verificaciones. Al cerrar un run solo se escriben estado, resultado y fecha de cierre; la configuración queda intacta. Los listados siempre filtran por usuario.

## HTTP

- `GET /api/intelligence/dataset`: conteos privados de particiones para la cuenta autenticada.
- `GET /api/intelligence/review-queue?cursor=...`: cola keyset-paginada de mensajes aún no verificados, ordenada por fecha recibida ascendente (del correo más antiguo al más reciente).
- `POST /api/intelligence/messages/:messageId/verifications`: agrega `CONFIRMED`, `CORRECTED` o `REJECTED`, etiquetas rápidas y nota.
- `GET /api/intelligence/runs`: historial de runs del usuario, con versiones, watermarks y configuración capturada.
- `GET /api/intelligence/messages/:messageId`: ahora incluye observaciones y verificaciones de ese mensaje como procedencia.

La cola, el detalle y las verificaciones se consultan con `userId` en cada acceso. La paginación usa `receivedAt` e ID como cursor estable. Rechazar saca el mensaje de la cola pero conserva su motivo e historial. Esta fase registra evidencia y etiquetas; la proyección de conocimiento se implementa en AI-4 y el análisis de correo en AI-5.
