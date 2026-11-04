# Señales (AI-7)

La inteligencia convierte un candidato financiero de AI-5 en una señal durable y consultable, con su evidencia, sin mutar datos de Finanzas. La clasificación solo publica cuando marca relevancia, incluye la ruta `FINANCE` y contiene un candidato `transaction`.

## Cardinalidad de correo

AI-5 conserva rutas/clasificaciones independientes, pero su candidato transaccional vive en el mensaje. AI-7 crea **una señal por correo** y guarda el candidato y todas las rutas de clasificación en el payload. En un correo que describa varias operaciones, esas operaciones quedan agrupadas en una sola señal. La clave de correlación se deriva de usuario y mensaje (`<userId>:email:<messageId>`), igual para el candidato completo; la deduplicación usa ese mismo mensaje. Separar operaciones requiere que AI-5 modele candidatos individualmente y queda fuera de este alcance.

## Entrega y ciclo de vida

La señal se crea con estado `ROUTED`, y la señal, su evidencia `EMAIL_CLASSIFICATION` y el evento `ai.signal.routed` se guardan de forma idempotente junto con la finalización de la clasificación. El relay del outbox publica el evento a BullMQ con un `jobId` estable derivado del `eventId`; si el enqueue falla, el relay reintenta el outbox. El procesador carga la señal por usuario y la entrega al consumidor registrado para su dominio. Para FINANCE, AI-11 consume el payload publicado: no lee Gmail ni modifica la señal fuente. Los resultados quedan en `payload.consumption` (`outcome`, `reason`, referencias de dominio y fecha). `APPLIED`/`ALREADY_APPLIED` pasan a `CONSUMED`; las señales de revisión permanecen `ROUTED` y el rechazo pasa a `FAILED`.

Los estados reservados para el flujo son `DETECTED`, `VALIDATED`, `ROUTED`, `CONSUMED`, `DISMISSED`, `SUPERSEDED` y `FAILED`. La lectura lista hasta 50 señales recientes y filtra tanto señales como evidencia por el usuario autenticado. `GET /api/intelligence/signals/:signalId` oculta señales ajenas devolviendo `404`.

La evidencia apunta al mensaje de correo y conserva la ruta, tipo semántico, confianza y procedencia del clasificador. No copia el cuerpo del mensaje. La eliminación de la fuente elimina en cascada la señal y su evidencia.
