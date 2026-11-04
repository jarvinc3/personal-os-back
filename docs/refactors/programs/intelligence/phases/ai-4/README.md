# AI-4 — Knowledge reconstruible y privado

**Issue:** [back #207](https://github.com/jarvinc3/personal-os-back/issues/207)

**PRs:** back [#229](https://github.com/jarvinc3/personal-os-back/pull/229), [#233](https://github.com/jarvinc3/personal-os-back/pull/233), [#234](https://github.com/jarvinc3/personal-os-back/pull/234), [#240](https://github.com/jarvinc3/personal-os-back/pull/240), [#241](https://github.com/jarvinc3/personal-os-back/pull/241); web [#343](https://github.com/jarvinc3/personal-os-web/pull/343).

## Objetivo

Derivar conocimiento desde evidencia versionada, con alcance USER o GLOBAL, que se pueda reconstruir y que no exponga datos privados.

## Alcance

- Proyección reproducible hasta un watermark y versiones explícitas.
- Conocimiento USER aislado y GLOBAL limitado a patrones estructurales seguros.
- Promoción sujeta a mayoría de al menos 2/3 y al mínimo de colaboradores con consentimiento; el rol no evita esos límites.
- Reversión ADMIN, exportación y borrado con eliminación de datos personales y tratamiento de evidencia retirada.
- Explorador de conocimiento y controles de usuario en web.

## Gate

Las mismas entradas y versiones reproducen la proyección; datos personales nunca llegan a GLOBAL; las revocaciones detienen el uso automático cuando corresponde; las eliminaciones no preservan datos personales; los runs sin evidencia suficiente quedan marcados como incompletos.

El [ADR vigente de AI-4](../../adr/ai-4-knowledge.md) fija los límites de promoción y privacidad.
