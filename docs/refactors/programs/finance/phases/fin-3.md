# FIN-3 — Importación desde señales

**Issue cubridor:** [AI-11 #214](https://github.com/jarvinc3/personal-os-back/issues/214)

**PRs:** [back #298](https://github.com/jarvinc3/personal-os-back/pull/298), [web #388](https://github.com/jarvinc3/personal-os-web/pull/388)

## Objetivo

Consumir señales de Finance con idempotencia y reutilizar la lógica financiera conservada, sin consultar Gmail desde Finance.

## Gate

Una señal crea o actualiza el estado financiero correcto; se conservan monto y moneda originales, tasa aplicada, procedencia, reversos y deduplicación; los casos ambiguos se envían a revisión.

La implementación está descrita en [AI-11](../../intelligence/phases/ai-11/README.md).

[Índice de fases de Finance](README.md).
