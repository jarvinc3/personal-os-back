# AI-8 — Capability Registry

**Issue:** [back #211](https://github.com/jarvinc3/personal-os-back/issues/211)

**PR:** [back #295](https://github.com/jarvinc3/personal-os-back/pull/295)

Esta fase también cubre el gate FIN-2.

## Objetivo

Descubrir y ejecutar capacidades registradas por módulos mediante contratos neutrales, sin un switch central ni imports de Finance desde el runtime genérico de IA.

## Alcance y gate

Registrar providers propiedad de módulos, validar entradas y salidas, resolver contexto y reportar capacidades duplicadas o no disponibles. Los tests cubren registro, descubrimiento, ejecución, validación y fallos de composición. Un módulo puede añadir una capacidad sin editar el runtime genérico.

[Índice de fases](../README.md).
