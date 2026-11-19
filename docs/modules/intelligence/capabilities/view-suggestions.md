# Sugerencias del agente por vista (#358)

Recurso propio de sugerencias cortas para la vista actual del usuario. No reutiliza `review-queue`, `knowledge` ni `signals`, y no consume la cuota del piloto de correo de #402.

## Decisiones del owner (19 nov 2026)

- **Origen:** las sugerencias se generan con inferencia del modelo a través del gateway existente y se guardan en caché por usuario y vista. Si no hay modelo o presupuesto, la fila queda vacía, sin error para el usuario.
- **Agrupación:** por ruta más vista o sheet, sin filtros ni entidad.
- **Forma:** cada sugerencia trae etiqueta corta, prompt de chat y una acción propuesta. La acción la gobierna AI-10 y nunca se aplica sin que el usuario la confirme.
- **Límites:** comparte con el correo solo el tope global de 5 USD/día. Tiene ritmo y cupo propios (20 por minuto y 100 por día) en tablas propias, para no consumir la cuota del piloto de correo de #402.

## Flujo

1. `GET /api/intelligence/view-suggestions?route=...&view=...` (o `sheet=...`) busca sugerencias `ACTIVE` no vencidas del usuario autenticado para esa vista.
2. Si la caché venció, reserva el ritmo del minuto (`ai_view_suggestion_minutes`), el cupo diario (`ai_view_suggestion_budgets`, `AI_VIEW_SUGGESTION_DAILY_MODEL_BUDGET`) y el costo máximo de la llamada en el tope global (`ai_email_daily_costs`, 5 USD/día). Las tres reservas son atómicas y valen entre réplicas.
3. `AiInferenceGateway` genera hasta tres sugerencias con salida estructurada validada; la etiqueta admite 80 caracteres y el prompt 500.
4. Se guardan en `ai_view_suggestions` con TTL (`AI_VIEW_SUGGESTION_TTL_MINUTES`, 30 minutos) y la reserva se ajusta al costo real medido.
5. Si falta ritmo, cupo, tope global, proveedor o una salida válida, la respuesta es `{ "suggestions": [] }` y queda un aviso en el log. La API no devuelve error por eso. Si el gateway rechaza la salida del modelo, la reserva se ajusta al costo que ya facturó; si el fallo no deja costo conocido, se libera la reserva completa y se devuelve el cupo diario. El ritmo del minuto queda consumido.

La caché no revive un descarte: la clave de la sugerencia es el SHA-256 de la etiqueta normalizada (sin mayúsculas ni espacios repetidos), el descarte cambia la fila a `DISMISSED` y la conserva, y una regeneración con la misma etiqueta no crea una fila nueva. Para no dejar la respuesta en error, la inserción usa `createMany` con `skipDuplicates` sobre la clave única de usuario, ruta, vista y sugerencia, y después se releen las activas guardadas: dos peticiones simultáneas con la caché vencida comparten el mismo resultado y la lista nunca supera tres. La consulta de claves descartadas se acota a 1000 por vista y usa el índice único, así que el costo no crece con el historial. Una sugerencia vencida que seguía activa se borra al regenerar la vista.

## Acciones propuestas (AI-10)

Cada sugerencia puede traer `action` con el `actionType` y los argumentos de una capacidad `WRITE` con política `CONFIRM_REQUIRED`. Al guardar la sugerencia se crea la propuesta `AiAction` con `originType: AGENT_SUGGESTION`; la web la confirma con el endpoint de acciones existente y nunca se aplica sola. Descartar la sugerencia o vencer su caché cancela la propuesta pendiente.

El gateway solo ofrece al modelo las capacidades `WRITE` con confirmación. Una acción con argumentos inválidos, con una capacidad de lectura o con política distinta se descarta y la sugerencia queda sin acción. Hoy el producto no registra capacidades `WRITE`, así que `action` será `null` hasta que exista una.

## Límites y costo

| Concepto                    | Valor                                                                |
| --------------------------- | -------------------------------------------------------------------- |
| Ritmo por usuario           | 20 generaciones por minuto                                           |
| Cupo diario por usuario     | 100 generaciones (`AI_VIEW_SUGGESTION_DAILY_MODEL_BUDGET`)           |
| Tope global compartido      | 5 USD por día UTC (`ai_email_daily_costs`)                           |
| Reserva por generación      | 0.04 USD en el peor caso; se ajusta al costo real                    |
| Costo esperado por consulta | alrededor de 0.0002 USD (unos 400 tokens de entrada y 250 de salida) |
| Caché                       | 30 minutos por usuario y vista (`AI_VIEW_SUGGESTION_TTL_MINUTES`)    |

En el peor caso, el tope global admite unas 125 reservas de sugerencias por día; en uso normal cada generación reserva 0.04 USD y liquida centésimas de centavo.

La exportación de datos de IA incluye las sugerencias por vista y «Borrar todos mis datos de IA» las elimina, igual que las conversaciones y las acciones. El vaciado selectivo por rama también las cuenta y las borra, y la rama correspondiente es `ai.viewSuggestions`.

## HTTP

Ver [contrato HTTP](../contracts/http.md#sugerencias-por-vista-358).

## Evidencia

- `packages/intelligence/src/suggestions/`
- `packages/intelligence/src/inference/inference-cost.ts`
- `test/intelligence.e2e-spec.ts`
