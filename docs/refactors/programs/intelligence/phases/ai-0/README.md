# AI-0 — Baseline limpia y corte controlado

**Issue:** [back #203](https://github.com/jarvinc3/personal-os-back/issues/203)

**PRs:** [back #195](https://github.com/jarvinc3/personal-os-back/pull/195), [web #311](https://github.com/jarvinc3/personal-os-web/pull/311), [integración web #312](https://github.com/jarvinc3/personal-os-web/pull/312)

## Objetivo

Retirar el runtime anterior de chat y la propiedad de Gmail que estaba en Finance, y fijar una baseline compatible con la siguiente arquitectura sin reescribir los algoritmos financieros conservados.

## Resultado y límites

La documentación del corte registra la baseline y los contratos, conserva la lógica financiera que se reutiliza en AI-11 y separa artefactos de diseño de migraciones activas. La validación descrita se hizo en entornos locales/DEV; no acredita escrituras ni despliegues en producción.

## Diseño y evidencia

- [Diseño técnico y resumen de aceptación](design/README.md)
- [Baseline](design/01-baseline.md)
- [Contratos](design/02-contracts.md)
- [Plan de archivos](design/03-file-plan.md)
- [OAuth y preflight](design/04-oauth-and-preflight.md)
- [Runbook DEV](design/05-runbook.md)
- [Matriz de pruebas](design/06-test-matrix.md)
- [Estado de ejecución](design/07-execution-status.md)
- [Artefactos históricos del reset](../../../../archive/reset/ai-0-artifacts/)

[Índice AI-0 a AI-12](../README.md).
