# FIN-1 — Retirar la propiedad legacy de fuentes

**Issue:** [back #317](https://github.com/jarvinc3/personal-os-back/issues/317)

## Objetivo

Eliminar de Finance la infraestructura y configuración de Gmail heredada, manteniendo los algoritmos financieros que hoy comparten código con la ingesta.

## Alcance

Retirar OAuth, sync/cursor/bootstrap, almacenamiento de correo, clasificación y revisión genérica de emails, más sus settings y endpoints. Eliminar junto con ello `FINANCE_TRANSACTION_IMPORTED`, `FinanceEmailSyncCompletedEvent` y sus listeners, copy y constantes exclusivos. Mantener normalización de transacciones, resolución de institución/instrumento, deduplicación, reversos, transferencias, importación al ledger y conciliación financiera, desacoplados de `FinEmail*`.

## Gate

Finance compila sin modelos o dependencias de Gmail/OAuth; no queda emisor, listener, copy o constante de eventos de importación por email. No se reescriben reglas de saldos.

**Dependencia:** AI-0 y AI-2 retiran la fuente del lado de Intelligence.

[Índice de fases de Finance](README.md).
