# Intelligence — overview

## Propósito

Kernel de proveedores de IA, inferencias estructuradas y runtime de conversación. AI-9 incorpora conversaciones privadas que consultan datos mediante capacidades registradas por los módulos.

## Alcance

- Multi-provider: Groq y OpenRouter, alternados por llamada y con respaldo al siguiente proveedor. Un proveedor que responde 429 o 402 queda en enfriamiento hasta el `Retry-After` que indique o, en su defecto, 60 segundos por ritmo y 30 minutos por cupo. Si todos están en enfriamiento, la inferencia falla sin llamarlos y la telemetría lo registra como `PROVIDER_COOLDOWN`.
- Inferencia estructurada validada por quien consume el resultado.
- Telemetría de inferencia minimizada y retenida 90 días.
- Runtime de conversación con historial y resumen privado por usuario.
- Bucle de capacidades `READ` y `WRITE` con política de acciones obligatoria para mutaciones.
- Primera capacidad de Finance: ingresos, gastos y flujo confirmado por mes.
- Política común AI-10 para futuras capacidades mutantes, con auditoría y confirmación.
- Exportación y borrado de conversaciones en el ciclo de datos AI.

## Fuera de alcance

La interfaz web de conversaciones espera la decisión del owner. Gmail es una fuente separada de inteligencia. Las capacidades `WRITE` pasan por la política común de [acciones](capabilities/actions.md); no hay aún un mutador de dominio registrado.

## Arquitectura

```text
inference/       # proveedores y gateway de inferencia
capabilities/    # registro genérico AI-8
conversations/   # store, contexto, orquestador y API AI-9
suggestions/     # sugerencias del agente por vista y descarte (#358)
proactive/       # ayuda proactiva por señal, relevancia y límites (AI-12)
actions/         # política y ejecución de acciones AI-10
email/           # Gmail, consentimiento y clasificación
evidence/        # dataset, runs y revisión humana
knowledge/       # proyección, privacidad y lápidas
signals/         # señales y evidencia durable
roles/           # roles de IA
consent/         # consentimiento de contribución
shared/          # tipos y utilidades internas
providers/       # clientes Groq y OpenRouter
```

El runtime de Intelligence no importa facades de dominio. Finance publica su proveedor de lectura desde `@personal-os/finance` y la API compone los proveedores.

**Barrel:** `AiModule`, `AiCoreModule`, `AiService`, `AI_DATA_BRANCHES`.
