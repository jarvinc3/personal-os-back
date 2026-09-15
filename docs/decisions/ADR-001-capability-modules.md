# ADR-001: Módulos Nest por feature/capability

- Estado: `accepted`
- Fecha: 2026-08 (documentado en `docs/architecture/modules.md`)

## Contexto

Un árbol global `controllers/` + `services/` no escala con finance (ledger, ingestión, catálogo) ni con AI (chat vs actions).

## Decisión

Organizar `src/modules/<feature>/` con capas `presentation` / `application` / `infrastructure` / `domain`. Módulos complejos usan carpetas de capability. Cross-module imports solo vía `index.ts` / façade. ESLint `no-restricted-imports`.

## Alternativas

Capas técnicas globales; hexagonal rígido con puerto por cada repositorio.

## Consecuencias

Finance y AI son la referencia. Auth no tiene `application/` vacío. Detalle: [architecture/modules.md](../architecture/modules.md).
