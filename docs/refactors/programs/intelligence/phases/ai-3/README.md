# AI-3 — Dataset, runs y verificación humana

**Issue:** [back #206](https://github.com/jarvinc3/personal-os-back/issues/206)

**PR relacionado:** no hay un PR de implementación único en el historial del issue. [#224](https://github.com/jarvinc3/personal-os-back/pull/224) actualizó Swagger; la release fue [#226](https://github.com/jarvinc3/personal-os-back/pull/226). La vista web tiene cambios relacionados en [#332](https://github.com/jarvinc3/personal-os-web/pull/332) y [#334](https://github.com/jarvinc3/personal-os-web/pull/334).

## Objetivo

Guardar evidencia con procedencia y permitir que una persona confirme, corrija o rechace clasificaciones sin alterar el HOLDOUT.

## Alcance

- Dataset `EMAIL_V1` con particiones deterministas y HOLDOUT congelado.
- Runs con versiones y watermarks de evidencia.
- Observaciones y verificaciones humanas append-only, con secuencia y rol.
- Cola de revisión, etiquetas y trazabilidad visible desde Intelligence.

## Gate

La partición es determinista y no se puede cambiar el HOLDOUT; cada item de conocimiento puede rastrearse a su evidencia; las verificaciones conservan procedencia; las acciones de revisión y sus filtros no permiten escribir etiquetas de HOLDOUT como aprendizaje.

El diseño original y su contexto se conservan en [el roadmap archivado](../../../../archive/intelligence/07-roadmap-and-testable-phases-v1.md#phase-3--dataset-analysis-runs-evidence-and-human-verification).
