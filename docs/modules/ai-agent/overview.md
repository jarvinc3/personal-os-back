# AI Agent — overview

## Propósito

Kernel de proveedores de IA, inferencias estructuradas y runtime de conversación. AI-9 incorpora conversaciones privadas que consultan datos mediante capacidades registradas por los módulos.

## Alcance

- Multi-provider: Groq y OpenRouter, con fallback.
- Inferencia estructurada validada por quien consume el resultado.
- Telemetría de inferencia minimizada y retenida 90 días.
- Runtime de conversación con historial y resumen privado por usuario.
- Bucle limitado a capacidades de lectura.
- Primera capacidad de Finance: ingresos, gastos y flujo confirmado por mes.
- Exportación y borrado de conversaciones en el ciclo de datos AI.

## Fuera de alcance

La política de acciones y cualquier mutación conversacional pertenecen a AI-10. La interfaz web del chat espera la decisión del owner. Gmail es una fuente separada de inteligencia.

## Arquitectura

```text
inference/       # proveedores y gateway de inferencia
capabilities/    # registro genérico AI-8
conversations/   # store, contexto, orquestador y API AI-9
intelligence/    # correo, evidencia, conocimiento y señales
```

El runtime de AI no importa facades de dominio. Finance publica su proveedor de lectura desde `@personal-os/finance` y la API compone los proveedores.

**Barrel:** `AiModule`, `AiCoreModule`, `AiService`, `AI_DATA_BRANCHES`.
