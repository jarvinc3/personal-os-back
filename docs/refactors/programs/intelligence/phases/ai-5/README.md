# AI-5 — Email Intelligence V1

**Issue:** [back #208](https://github.com/jarvinc3/personal-os-back/issues/208)

**PRs:** back [#292](https://github.com/jarvinc3/personal-os-back/pull/292), web [#379](https://github.com/jarvinc3/personal-os-web/pull/379)

## Objetivo

Clasificar correos y detectar candidatos financieros usando conocimiento, parsers deterministas e inferencia validada, sin crear movimientos en Finance.

## Alcance

Resolver conocimiento USER antes que GLOBAL, normalizar plantillas, clasificar relevancia y rutas, usar inferencia como respaldo acotado, registrar observaciones y enviar incertidumbre a revisión. El presupuesto de LLM limita las llamadas y permite detener/reanudar el trabajo. La interfaz muestra el método, el conocimiento utilizado y el proveedor/modelo cuando corresponda.

## Gate

Los correos irrelevantes no generan llamadas de inferencia salvo auditorías permitidas; entradas con instrucciones maliciosas no cambian las reglas; resultados dudosos van a revisión; la ruta no crea transacciones financieras.

[Índice de fases](../README.md).
