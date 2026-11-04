# PLATFORM-EVENTS-0 — Propiedad semántica de eventos

**Issue:** [back #243](https://github.com/jarvinc3/personal-os-back/issues/243)

**PR:** [back #303](https://github.com/jarvinc3/personal-os-back/pull/303)

## Objetivo

Mover nombres y DTOs de eventos a los dominios que definen su semántica, sin cambiar el transporte compartido.

## Gate

El catálogo de Core conserva infraestructura genérica y no define los eventos de Finance. Los listeners mantienen nombres y entrega compatibles.

[Índice de fases de plataforma](README.md).
