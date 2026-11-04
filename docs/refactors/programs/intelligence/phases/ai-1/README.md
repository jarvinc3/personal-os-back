# AI-1 — Inference Gateway

**Issue:** [back #204](https://github.com/jarvinc3/personal-os-back/issues/204)

**PRs:** [implementación #196](https://github.com/jarvinc3/personal-os-back/pull/196), [estado de DEV #197](https://github.com/jarvinc3/personal-os-back/pull/197)

## Objetivo

Concentrar las llamadas a modelos en un gateway que valida salidas estructuradas, registra telemetría minimizada y permite fallback sin acoplar los módulos a un proveedor concreto.

## Alcance y gate

Migrar los consumidores de LLM previstos, mantener validación de esquema y cubrir éxito, error, reintentos, fallback y proveedor preferido. La fase queda útil cuando los extractores financieros siguen funcionando de extremo a extremo y ningún paquete llama directamente a un proveedor.

## Diseño

El [diseño del Inference Gateway](design.md) contiene contratos, proveedores, telemetría y pruebas.

[Índice AI-0 a AI-12](../README.md).
