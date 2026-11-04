# AI-10 — Action Policy

**Issue:** [back #213](https://github.com/jarvinc3/personal-os-back/issues/213)

**PR:** [back #297](https://github.com/jarvinc3/personal-os-back/pull/297)

## Objetivo

Aplicar una policy explícita antes de cualquier mutación del agente y conservar un registro auditable de la acción.

## Alcance y gate

Las capacidades mutantes declaran `AUTO_ALLOWED`, `CONFIRM_REQUIRED` o `FORBIDDEN`. Se conservan confirmación, cancelación, claims atómicos, carreras y resultados. Ninguna mutación del agente evita la policy o el registro de acción.

[Índice de fases](../README.md).
