# AI-6 — Evaluación sobre HOLDOUT

**Issue:** [back #209](https://github.com/jarvinc3/personal-os-back/issues/209)

**PRs:** back [#293](https://github.com/jarvinc3/personal-os-back/pull/293), web [#382](https://github.com/jarvinc3/personal-os-web/pull/382)

## Objetivo

Comparar runs de evaluación sobre una membresía HOLDOUT congelada sin convertir la evaluación en aprendizaje.

## Alcance

Ofrecer modos de análisis/evaluación, métricas y comparación entre runs compatibles. Las métricas incluyen recall y precisión de transacciones, cobertura determinista, tasa de fallback de LLM y tasa de desconocidos. La vista de revisión completa filtros por incertidumbre y permite revisar resultados sin cambiar la evidencia del HOLDOUT.

## Gate

Un HOLDOUT no aporta aprendizaje; la misma versión y watermark permite una comparación válida; las métricas y deltas son reproducibles; cada evaluación nueva conserva su propio run y no altera Knowledge.

[Índice de fases](../README.md).
