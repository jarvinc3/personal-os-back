# Guía del CHANGELOG

Formato y reglas para `CHANGELOG.md` y para la versión de `package.json`. Léelo completo antes de cerrar una sesión.

## Reglas

- Un release por sesión de agente, aunque el cambio sea pequeño.
- La versión vive en `package.json` de la raíz. Una sola versión para todo el monorepo: `apps/api` y todos los `packages/*` viajan juntos y no se publican por separado.
> Mientras el proyecto esté en beta (`0.x`), la política de [docs/versionado.md](../versionado.md) manda: un cambio incompatible sube MINOR y `1.0.0` solo la decide el usuario.

- El bump es el más alto de la sesión:
  - `MAJOR`: rompe un contrato o los datos guardados (endpoint, DTO, esquema, formato de un campo) y un cliente anterior deja de funcionar.
  - `MINOR`: agrega un endpoint, una capacidad o un dato nuevo.
  - `PATCH`: corrección, texto, refactor sin cambio de comportamiento, documentación.
- El `CHANGELOG.md` va en español, de la versión más nueva a la más vieja.
- El `CHANGELOG.md` de la raíz lleva el año en curso. Al cerrar el primer release de un año nuevo, mueve las versiones del año anterior a `docs/changelog/AAAA.md`, sin editar su contenido, y deja el año nuevo en la raíz.
- Cada versión lleva su fecha en `AAAA-MM-DD`.
- Las secciones que no aplican no se escriben.
- El tag de git es `vX.Y.Z` y se crea después del commit del release.
- `personal-os-app` está fuera de servicio y no sigue esta regla.

## Secciones

| Sección     | Cuándo                                         |
| ----------- | ---------------------------------------------- |
| `Agregado`  | algo nuevo para quien consume el API           |
| `Cambiado`  | un comportamiento existente que cambia         |
| `Obsoleto`  | algo que sigue funcionando pero se va a quitar |
| `Eliminado` | algo que se quitó                              |
| `Corregido` | un fallo que se arregló                        |
| `Seguridad` | un problema de seguridad                       |

## Ejemplo

```markdown
# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y [SemVer](https://semver.org/lang/es/).

## [1.4.0] - 2026-10-12

### Agregado

- `POST /api/finance/<entidad>/:id/restore` deshace un borrado desde `fin_deletion_journal`.

### Corregido

- Los DTO de préstamo rechazan un saldo mayor que el monto original.

## [1.3.3] - 2026-10-05

### Cambiado

- El aporte a una meta crea el movimiento en la cuenta de origen.
```

## Pasos al cerrar la sesión

1. Elige el bump más alto de la sesión.
2. Si cambió el año, mueve las versiones del año anterior a `docs/changelog/AAAA.md`.
3. Agrega la entrada arriba del todo en `CHANGELOG.md`, con la versión nueva y la fecha de hoy.
4. Sube `version` en `package.json`.
5. Corre `pnpm format:check`, `pnpm lint` y `pnpm test`.
6. Commitea `chore(release): vX.Y.Z`.
7. Crea el tag: `git tag vX.Y.Z`.
