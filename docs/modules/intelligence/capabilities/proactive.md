# Ayuda proactiva por señal (#215, AI-12)

Una señal que quedó esperando una decisión del dueño produce una sugerencia y avisa. El resto de los eventos no llega al modelo, no gasta presupuesto y no notifica.

## Decisiones del owner (19 nov 2026)

- **Disparador:** las señales estructuradas que ya se enrutan (`ai.signal.routed` → `ai_signals`), no los eventos de dominio del outbox.
- **Relevancia:** reglas deterministas por tipo de señal, sin modelo antes de decidir.
- **Salida:** sugerencia listada más notificación interna (`IN_APP`).
- **Frecuencia:** al alcanzar el límite el evento se descarta y el listado informa el conteo.
- **Topes:** se reutilizan los de sugerencias por vista (20 por minuto y 100 por día) y el tope global de 5 USD/día.
- **Versión:** se registra bajo `Unreleased — 0.100.0`, sin etiqueta; el corte lo decide el owner.

## Flujo

1. `AiSignalRoutingProcessor` entrega la señal al consumidor de su dominio y registra el resultado.
2. `AiProactiveService.consider` aplica la regla de relevancia (`proactive-relevance.ts`): tipo de señal conocido y consumo en `REVIEW_REQUIRED`. Una señal fuera de esas condiciones termina sin efecto, sin modelo y sin notificación.
3. La sugerencia del evento se busca por usuario y señal. Si existe, no se vuelve a razonar.
4. Se reservan ritmo, cupo diario y costo máximo con los topes de sugerencias por vista. Sin reserva no hay razonamiento: el evento se cuenta como omitido en `ai_proactive_discards` y el listado devuelve `limits.discarded`.
5. `ProactiveSuggestionGenerator` pide la sugerencia al `AiInferenceGateway` con salida validada. Al modelo solo viajan el tipo de señal y el motivo de revisión, nunca el payload del correo ni cuerpos de mensaje.
6. Se guarda una fila en `ai_proactive_suggestions` con su origen (`signalId` y `signalType`). La clave única por usuario y señal deja una sola sugerencia por evento aunque el outbox reintente la entrega.
7. Si la salida trae una acción, solo se propone cuando la capacidad es `WRITE` con `CONFIRM_REQUIRED`: pasa por la política AI-10 (`proposeFromSuggestion`) y queda pendiente de confirmación. Nunca se aplica sola.
8. Se envía el aviso interno con `NOTIFICATION_INTENT_SINK` y una clave de deduplicación por usuario y señal.

Un fallo del modelo no deja sugerencia ni aviso: se ajusta la reserva al costo conocido o se libera el cupo diario.

## API

`GET /api/intelligence/proactive-suggestions` devuelve las últimas sugerencias del usuario autenticado y el conteo de eventos omitidos en la ventana vigente.

```json
{
  "suggestions": [
    {
      "id": "uuid",
      "signalId": "uuid",
      "signalType": "FINANCE.TRANSACTION_DETECTED",
      "title": "Tenés un movimiento por revisar",
      "body": "Quedó esperando una decisión.",
      "actionId": null,
      "createdAt": "2026-11-19T18:00:00.000Z"
    }
  ],
  "limits": { "discarded": 0, "windowStartedAt": null }
}
```

## Límites

| Concepto          | Valor                                           |
| ----------------- | ----------------------------------------------- |
| Señales razonadas | 20 por minuto y 100 por día (topes compartidos) |
| Costo             | tope global de 5 USD por día UTC                |
| Ventana de conteo | un minuto, alineada al reloj                    |
| Una por evento    | clave única `(userId, signalId)`                |

## Pruebas

- `proactive-relevance.spec.ts`: relevancia por estado, tipo y consumo; ventana al minuto.
- `ai-proactive.service.spec.ts`: sin relevancia no razona ni notifica, una sola sugerencia por evento, sin duplicados al reprocesar, sin modelo al agotarse el ritmo, acción propuesta sujeta a confirmación y fallo del modelo sin efectos.
- `ai-signal-routing.processor.spec.ts`: la proactividad mira la señal después de registrar el resultado del consumidor.
- `test/proactive-suggestions.e2e-spec.ts`: contrato HTTP del listado.
