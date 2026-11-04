# AI-12 — Proactive Intelligence

**Issue:** [back #215](https://github.com/jarvinc3/personal-os-back/issues/215)

## Objetivo

Usar señales y contexto para decidir si corresponde no actuar, sugerir algo o proponer una acción, sin convertir cada evento en una llamada a un modelo o en un mensaje de chat.

## Alcance previsto

Correlacionar señales, aplicar relevancia y policy antes de cualquier razonamiento opcional y devolver un resultado seguro: ninguna acción, una sugerencia o una acción gobernada por AI-10.

## Gate

La ayuda proactiva no dispara inferencia para cada evento, respeta aislamiento y policy, y no envía mensajes o mutaciones sin autorización explícita.

No iniciar esta fase como parte de `0.100.0`. Consulta el [issue](https://github.com/jarvinc3/personal-os-back/issues/215) y el [roadmap maestro](../../../../01-master-roadmap.md).
