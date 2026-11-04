# AI-7 — Signals

**Issue:** [back #210](https://github.com/jarvinc3/personal-os-back/issues/210)

**PRs:** back [#294](https://github.com/jarvinc3/personal-os-back/pull/294), web [#385](https://github.com/jarvinc3/personal-os-web/pull/385)

## Objetivo

Publicar señales derivadas de correo con evidencia y ciclo de vida propio, sin mutar directamente Finance ni convertir Notifications en un bus de señales.

## Alcance

Una señal conserva deduplicación, correlación, estado y enlaces a evidencia. La entrega durable usa el puente aprobado a BullMQ y mantiene las garantías de outbox exigidas por la plataforma.

## Gate

Un correo puede producir varias señales sin duplicados; cada señal tiene evidencia trazable y respeta el aislamiento del usuario; la detección no crea movimientos financieros.

[Índice de fases](../README.md).
