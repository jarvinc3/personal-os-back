# AI Agent — overview

## Propósito

Kernel de proveedores de IA e inferencias estructuradas. El runtime de chat se retiró en AI-0. El gateway valida las respuestas y da servicio a consumidores de Finance por el contrato neutral.

## Alcance

- Multi-provider: Groq, OpenRouter
- Cadena de respaldo en ese orden; cada proveedor entra solo si su key existe
- Pool multi-provider con round-robin, proveedor preferido y failover
- Salida JSON estructurada y validación local del consumidor
- Telemetría minimizada y retenida 90 días; borrado de usuario en cascada
- Extractores de Finance: inyectan `INFERENCE_COMPLETION` desde contracts, sin
  importar AI. AiCoreModule global conecta el puerto con el gateway.
- Rama de autogestión `ai.inferences` para borrar su telemetría

## Fuera de alcance

Chat, sesiones, acciones del agente y Gmail fueron retirados en AI-0; su regreso requiere las fases futuras del roadmap.

## Arquitectura

```text
ai.module.ts          # módulo del kernel
ai-core.module.ts     # AI_PROVIDER, pool, gateway y contratos
inference/            # inferencia, retención y rama de borrado
providers/            # adaptadores Groq y OpenRouter
```

**Barrel:** `AiModule`, `AiCoreModule`, `AiService`, `AI_DATA_BRANCHES`.
Los límites de extracción e insights pertenecen a `@personal-os/config`.
