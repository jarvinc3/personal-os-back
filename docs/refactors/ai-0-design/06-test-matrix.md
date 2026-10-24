# Matriz de aceptación y evidencia

Seguimiento: [#193](https://github.com/jarvinc3/personal-os-back/issues/193).

| Fase                   | Given / When / Then                                                                                                    | Evidencia requerida                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| AI-0 esquema           | Dada una base vacía, al aplicar baseline, existen 44 tablas, 18 checks y 4 índices parciales conservados               | Catálogo SQL y drift Prisma                       |
| AI-0 aislamiento       | Dados dos usuarios, al consultar con rol autenticado y filtro de identidad, no se leen filas ajenas                    | PostgreSQL real; no mock                          |
| AI-0 privilegios       | Dada una conexión anon/authenticated, al intentar acceso directo, los REVOKE siguen vigentes                           | Grants y prueba de permisos                       |
| AI-0 Auth              | Dadas identidades nuevas y anteriores al reset, al disparar alta/reconciliar, existe un perfil único                   | Trigger y reconciliación idempotente              |
| AI-0 Finance           | Dados fixtures de importación, al retirar FinEmail, dedupe, reversos, resolución y transferencias conservan resultados | Suites financieras ejecutables sin skip           |
| AI-0 acciones          | Dado un usuario ajeno o estado no PENDING, al reclamar/cancelar, no se cambia la acción                                | CAS persistido sin joins de sesión                |
| AI-0 superficie        | Dado el corte desplegado, al invocar chat/Gmail o sus schedulers, no existen rutas/productores antiguos                | E2E HTTP y registro de workers                    |
| AI-0 preservación      | Dados Resend, entidad financiera, settings y wipe vigentes, al usarlos siguen funcionando                              | E2E y smoke Supabase DEV/web                      |
| AI-1 inferencia        | Dado fallo de proveedor, al completar, fallback/pool preservan comportamiento y métricas                               | Unitarias del pool y timeout/cancelación          |
| AI-1 límites           | Dado consumidor de inferencia, al compilar, no depende de chat ni importa Finance                                      | Build de paquetes y grafo de imports              |
| AI-2 settings          | Dados ajustes anteriores, al normalizar/aplicar patch, defaults y valores válidos se conservan                         | Fixtures de migración; rechazo de patch inválido  |
| AI-2 aislamiento       | Dados dos usuarios, al cambiar rol/consentimiento, solo cambia configuración propia y queda versión/auditoría          | Integración PostgreSQL y E2E autenticado          |
| AI-2 no consentimiento | Dado usuario nuevo o revocación, al producir evidencia, no se incorpora a GLOBAL sin autorización vigente              | Tests de política; integración completa en AI-3/4 |

AI-3/4 completan marcas separadas, tombstones y reconstrucción: retirar evidencia
debe desactivar una promoción automática insuficiente llevándola a revisión;
solo consentimiento ACTIVE al borrar permite contribución estructural anónima.
Runs históricos sin evidencia deben marcar INCOMPLETE y contar faltantes. No
afirmar que una prueba de settings AI-2 demuestra esos flujos todavía inexistentes.
La unicidad USER/GLOBAL debe probar concurrencia real con índices parciales y
CHECK de scope/userId cuando se agreguen esos modelos.

## Validación ya realizada del diseño

[validation-report.json](artifacts/validation-report.json) contiene 18 checks
verdes contra PostgreSQL local 17.2, con fixtures mínimos de Auth/Storage.
`validate-baseline.mjs` crea una base nueva de nombre aleatorio; requiere URL
explícita loopback y nunca carga credenciales de `.env`. No reinicia una base
existente. El resultado acredita SQL, no APIs gestionadas de Supabase.

La rama también pasa las suites unitarias back/web, 120 E2E back relevantes,
build Nest/paquetes, typecheck web y sus gates de lint/formato. La matriz de
smoke final sobre Supabase DEV sigue pendiente de identificar y restaurar ese
proyecto.

Para reproducir: levantar un cluster local aislado con roles de fixture
anon/authenticated/service_role, definir `AI0_VALIDATION_ADMIN_URL` apuntando
explícitamente a ese cluster y ejecutar `node` sobre el script. No usar una URL
de DEV/PROD. Los generadores también exigen URL local explícita para el catálogo.
No generar el cliente Prisma desde el schema dentro de docs.

Ejemplo PowerShell, solo para un cluster de fixtures ya preparado en loopback:

```powershell
$env:AI0_VALIDATION_ADMIN_URL = 'postgresql://postgres@127.0.0.1:55439/postgres'
node docs/refactors/ai-0-design/artifacts/validate-baseline.mjs
# Usar el databaseName que devuelve validation-report.json, nunca una base remota.
$report = Get-Content docs/refactors/ai-0-design/artifacts/validation-report.json | ConvertFrom-Json
$env:DATABASE_URL = 'postgresql://postgres@127.0.0.1:55439/' + $report.databaseName
pnpm exec prisma migrate diff --from-config-datasource --to-schema docs/refactors/ai-0-design/artifacts/schema.prisma --exit-code
Remove-Item Env:AI0_VALIDATION_ADMIN_URL
Remove-Item Env:DATABASE_URL
```

La comparación ejecutada sobre la base del reporte devolvió **No difference
detected**. Los dos borradores TypeScript también pasan `tsc --noEmit --strict`
con target ES2022; esto valida las firmas, no una implementación de providers.

La implementación debe pasar además `pnpm format:check`, `pnpm lint`,
`pnpm test`, `pnpm test:e2e`, build, money guard, integración PostgreSQL y drift.
La suite outbox existente mantiene sus pruebas de muerte de proceso antes y
después del commit. Signals exige, en AI-7, puente BullMQ con jobId estable,
retry, lease y entrega sin pérdida; no basta con afirmar idempotencia por un
registro CLAIMED anterior al efecto.
