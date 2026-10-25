# Pull request template

## Qué cambia

<!-- Una o dos frases. El detalle vive en el issue. -->

## Por qué

Closes #

## Comprobaciones

- [ ] `pnpm format:check`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm test:e2e`
- [ ] `CHANGELOG.md` actualizado bajo la versión que corresponde

## Base de datos

- [ ] Sin migraciones
- [ ] Migración nueva con la fecha real del sistema
- [ ] Cambio de esquema documentado y probado en DEV

## Riesgo

<!-- Qué puede romper, qué se probó a mano y qué queda fuera. -->
