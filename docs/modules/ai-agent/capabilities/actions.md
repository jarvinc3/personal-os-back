# Política y ejecución de acciones (AI-10)

Toda capacidad que pueda mutar datos declara `effect: WRITE` y una política explícita:

| Política           | Comportamiento                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `AUTO_ALLOWED`     | Registra la propuesta, la reclama de forma atómica y la ejecuta sin confirmación.        |
| `CONFIRM_REQUIRED` | Registra la propuesta como `PENDING`; no llama al dominio hasta que el usuario confirma. |
| `FORBIDDEN`        | Registra el rechazo como `FAILED` y no llama al dominio.                                 |

El registry rechaza al arrancar una definición `WRITE` sin política. En ejecución exige una fila propia `AiAction` en `RUNNING`, con la misma capacidad, decisión, versión y SHA-256 de argumentos validados. Una llamada directa al registry o un payload cambiado no llega al proveedor del dominio.

## Estado y concurrencia

`AiActionStatus`: `PENDING`, `RUNNING`, `SUCCESS`, `FAILED`, `CANCELLED`. `AiActionPolicy` y `policyVersion` preservan la decisión tomada; `argumentDigest` vincula la confirmación con el payload exacto. `result` guarda el resultado validado o un código de error tipado y sanitizado.

`POST /api/ai/actions/:actionId/confirm` hace compare-and-set `PENDING → RUNNING`. Solo quien gana el claim llama una vez a la capacidad. Las confirmaciones posteriores devuelven `ALREADY_CLAIMED` mientras sigue en curso o `ALREADY_EXECUTED` después del éxito. La cancelación también reclama `PENDING` con compare-and-set. La reaper marca `RUNNING` por más de 15 minutos como `FAILED`, cada 5 minutos.

Todas las rutas requieren JWT y consultan por `userId` autenticado. El listado devuelve hasta 100 acciones propias recientes. El export AI incluye payload y resultado; la rama `ai.actions` permite contarlos y borrarlos.

No hay capacidades de dominio `WRITE` registradas todavía; AI-10 aporta el límite común y las siguientes capacidades deberán proponer una política concreta. Sin política expresa, el comportamiento es fail-closed.
