# AI-11 — Finance IMPORT

**Issue:** [back #214](https://github.com/jarvinc3/personal-os-back/issues/214)

**PRs:** back [#298](https://github.com/jarvinc3/personal-os-back/pull/298), web [#388](https://github.com/jarvinc3/personal-os-web/pull/388)

Esta fase también cubre el gate FIN-3.

## Objetivo

Importar señales financieras de forma idempotente, reutilizando reglas financieras conservadas y sin dar a Finance acceso a Gmail.

## Alcance

El consumidor reutiliza extracción, resolución de institución/instrumento, deduplicación, reversos, transferencias y conciliación. Conserva procedencia y, para moneda distinta de la del producto, monto original, moneda original y tasa aplicada. Los casos ambiguos quedan para revisión.

## Gate

Una señal produce el estado financiero correcto sin lectura de correo; duplicados no duplican movimientos; reversos y pendientes conservan su semántica; la traza de señal y evidencia se puede consultar desde la interfaz.

[Índice de fases](../README.md).
