# Inferencia estructurada

## Contrato

Finance llama `INFERENCE_COMPLETION.infer` desde `@personal-os/contracts`; no
importa `packages/intelligence` ni SDK de proveedor. El gateway recibe mensajes,
tarea, versiones de prompt/esquema y un validador del dueño del dato. Añade el
JSON Schema a las instrucciones del modelo, extrae JSON, valida y solo devuelve
un valor tipado validado. Un error de proveedor, JSON o esquema permite probar
el siguiente proveedor configurado una vez por solicitud.

## Consumidores vigentes

- `finance.quick-entry`: tarea `finance.quick-entry`, versión de prompt
  `quick-entry-v1` y esquema `quick-entry-extraction-v1`.
- `finance.statement-import`: tarea `finance.statement-extraction`, con `userId`
  e `importId` en `sourceId` como contexto correlacionable.

Finance mantiene las reglas financieras y transformaciones de sus esquemas. La
entrada no confiable del usuario o del estado de cuenta se considera contenido,
nunca instrucciones.

## Telemetría y privacidad

`ai_inferences` registra dueño, tarea, tipo/id de origen, proveedor/modelo,
versiones, resultado operativo, latencia, fallbacks, uso de tokens si el SDK lo
devuelve, huella HMAC con versión explícita, costo estimado en `cost_usd` y
vencimiento a 90 días. El costo usa la tarifa del modelo y, si no está en la
tabla, un precio conservador por defecto. No guarda prompts, respuestas,
contenido de errores ni secuencias de tokens. La clave HMAC
deriva `DATA_ENCRYPTION_KEY` con el propósito versionado
`personal-os:ai-inference:fingerprint:v1`; rotar la clave de cifrado rota la
huella y no requiere conservar el texto original.

Las escrituras de telemetría son best effort: un fallo se registra como warning
sanitizado y no descarta una inferencia válida. El cron diario elimina filas
vencidas. La telemetría vence 90 días después de crearse. El FK elimina las
filas al borrar al usuario; el usuario también
puede borrarlas desde la rama `ai.inferences` de `GET /api/users/me/data/branches`
y `DELETE /api/users/me/data`.

Cada fallo de proveedor deja una línea de log con proveedor, modelo, estado
HTTP, si era reintentable, si se intentó el siguiente proveedor y una causa
resumida: `rate_limit`, `quota`, `auth`, `server`, `network` o `unknown`. El
mensaje del SDK se sanea y se trunca; nunca se registran claves, la cabecera
`Authorization` ni cuerpos del proveedor. La telemetría del fallo final conserva
el prefijo `PROVIDER_FAILURE` y añade `cause`, `status` y `retryable` al código;
no guarda el mensaje crudo.

## Diagnóstico local

Con al menos una clave de proveedor en `.env`, ejecutar `pnpm ai:diagnostic`.
Usa un prompt sintético, muestra tarea, proveedor, modelo, salida, latencia,
fallbacks y error, y no envía `userId`; por ello no crea telemetría.
Si falla, muestra el último proveedor/modelo intentado, número de intentos,
código normalizado y estado HTTP cuando está disponible. Nunca imprime el
mensaje crudo del SDK ni la clave.

Para probar un proveedor de forma aislada, pasar `groq` o `openrouter`, por
ejemplo `pnpm run ai:diagnostic -- --provider groq`.
