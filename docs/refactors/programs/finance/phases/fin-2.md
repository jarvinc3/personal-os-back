# FIN-2 — Capacidades y contexto de Finance

**Issue cubridor:** [AI-8 #211](https://github.com/jarvinc3/personal-os-back/issues/211)

**PR:** [back #295](https://github.com/jarvinc3/personal-os-back/pull/295)

## Objetivo

Retirar `FinanceFacade` como frontera universal para IA y reemplazar contratos de chat por capacidades y resolutores de contexto propiedad de Finance.

## Gate

El runtime genérico de IA no importa la implementación ni el facade de Finance; Finance no importa entidades o contratos de contexto de chat. Finance conserva el derecho de resolver sus propias entidades detrás de adaptadores.

La implementación está descrita en [AI-8](../../intelligence/phases/ai-8/README.md).

[Índice de fases de Finance](README.md).
