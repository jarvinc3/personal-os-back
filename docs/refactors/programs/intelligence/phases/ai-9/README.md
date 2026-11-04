# AI-9 — Agent Runtime V2

**Issue:** [back #212](https://github.com/jarvinc3/personal-os-back/issues/212)

**PR:** [back #296](https://github.com/jarvinc3/personal-os-back/pull/296)

## Objetivo

Permitir consultas del agente sobre datos reales a través de capacidades, con conversaciones e historial privados por usuario.

## Alcance y límite

El runtime reúne contexto, ejecuta herramientas de solo lectura y obtiene inferencia desde el gateway. La UX de chat web permanece pendiente del rediseño del owner; el cierre del issue no autoriza empezar ese trabajo de interfaz.

## Gate

Una pregunta financiera se responde mediante una capacidad sin dependencia directa de `FinanceFacade`; conversaciones, resúmenes y datos siguen aislados por usuario.

[Índice de fases](../README.md).
