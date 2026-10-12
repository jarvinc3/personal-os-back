# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y [SemVer](https://semver.org/lang/es/). Reglas y ejemplo en [docs/reference/changelog-guide.md](./docs/reference/changelog-guide.md).

## [1.6.0] - 2026-10-12

### Agregado

- `GET /api/finance/recycle-bin`: lista las instituciones, cuentas, tarjetas y préstamos archivados (`isActive:false`) y los borrados pendientes del diario, con una etiqueta visible para cada uno.

## [1.5.2] - 2026-10-12

### Corregido

- Las pruebas E2E de borrado vuelven a pasar: el mock de Prisma cubre los modelos que leen los borrados y el historial de borrados.

## [1.5.1] - 2026-10-12

### Cambiado

- La versión del build se resuelve una sola vez al arrancar, sin estado mutable dentro del getter.

## [1.5.0] - 2026-10-12

### Agregado

- `/api/health` devuelve `version`, leída del `package.json` de la raíz.

### Cambiado

- Swagger deja de mostrar `1.0` fijo y usa la versión del `package.json`.
- La documentación pasa prettier: el script de formato cubre `md` y existe `format:check`.

## [1.4.0] - 2026-10-12

### Agregado

- Deshacer un borrado: cada `DELETE` de finance guarda un snapshot en `fin_deletion_journal` y `POST /api/finance/<entidad>/:id/restore` repone las filas, los enlaces que la cascada anuló y el saldo y presupuesto revertidos.
- `PATCH /api/finance/transfers/:id` para editar una transferencia.
- El aporte a una meta de ahorro se liga a la cuenta de la que sale el dinero y crea su movimiento.

### Cambiado

- Los DTO de alta y edición de préstamo rechazan saldo mayor que el monto original, cuota menor o igual a cero y cuotas pagadas mayores que el total.
- El contexto de Finanzas del agente pide responder con un enlace a `/finance/loans/new` con los valores del préstamo.

### Corregido

- La herramienta de IA de aporte a meta no enviaba la cuenta que exige el DTO.
