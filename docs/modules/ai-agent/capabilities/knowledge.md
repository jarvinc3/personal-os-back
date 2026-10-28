# Knowledge Engine (AI-4)

Estado: `VERIFICADO` en código y pruebas, integrado en `develop` mediante el PR #229. La validación manual de QA y el cierre del issue #207 siguen pendientes.

`AiKnowledge` es una proyección reconstruible. Las fuentes son observaciones y verificaciones humanas con secuencias; `AiConsentEvent` registra los cambios de consentimiento. Un rebuild lee los máximos de las tres secuencias y la evidencia confirmada bajo una sola transacción PostgreSQL `REPEATABLE READ`. El run registra los tres watermarks, versiones y `snapshot: REPEATABLE_READ`.

El proyector genera claves `EMAIL_SENDER`, `EMAIL_DOMAIN` y `EMAIL_TEMPLATE` con `NORMALIZER_VERSION`. El remitente solo aparece en USER. GLOBAL solo admite dominio y plantilla; una plantilla con palabras literales fuera del vocabulario estructural permitido se mantiene en USER para evitar nombres, comercios o referencias en la clave compartida. El payload GLOBAL se construye por lista permitida: relevancia, tipo semántico, rutas y `transaction.kind`. Se excluyen HOLDOUT, verificaciones rechazadas, usuarios sin consentimiento y observaciones derivadas de conocimiento. `REJECTED` suma a `rejectedMessages` pero no aporta etiqueta. La observación automática puede crear USER `OBSERVED`; no promueve GLOBAL por sí sola.

Por mensaje rige la verificación de mayor secuencia. USER toma la más reciente para cada clave. GLOBAL cuenta un voto por mensaje y etiqueta; la ganadora requiere más votos que cualquier empate, al menos 2/3 del total y el mínimo de colaboradores distintos de `AI_GLOBAL_MIN_CONTRIBUTORS`. El valor por defecto es 1 en `NODE_ENV=development` para QA y 3 en test/production. Sin soporte suficiente, `REVIEW_REQUIRED` no se expone al usuario general. Una etiqueta `SECURITY_ALERT` tampoco se auto-promueve aunque cumpla el umbral: queda en `REVIEW_REQUIRED` para revisión ADMIN. Un ADMIN puede registrar una reversión como verificación append-only, que deja el ítem `BLOCKED`. Antes de activar la promoción GLOBAL en producción, el aviso de privacidad del opt-out debe estar publicado; no bloquea `develop` (ADR).

El reinicio de correo, el borrado de datos AI y la eliminación de cuenta llaman la misma ruta de anonimización. Se eliminan correos y USER knowledge; las verificaciones y observaciones pierden `userId`, origen, payload y notas. Las lápidas elegibles conservan solo estructura y un `contributorTombstone` aleatorio, compartido entre las filas del usuario borrado para contar colaboradores distintos. HOLDOUT y el consentimiento revocado nunca producen lápidas elegibles. Los runs afectados pasan a `INCOMPLETE` con conteos por tipo en `missingEvidence`; no son aptos para comparación de evidencia equivalente. La exportación JSON omite tokens OAuth.

La proyección se borra y vuelve a crearse dentro de la misma transacción. Los ítems GLOBAL que perdieron toda la evidencia permanecen en `REVIEW_REQUIRED` con contadores de soporte cero, salvo que una reversión ADMIN los deje `BLOCKED`. Los índices parciales impiden duplicados por clave y alcance; el CHECK exige `userId` solo en USER.

## Evidencia

- `packages/ai-agent/src/intelligence/knowledge/knowledge-projector.spec.ts`: normalización, saneamiento, determinismo, corrección, umbral, HOLDOUT, consentimiento, realimentación, lápidas por versión y reversión ADMIN.
- `packages/ai-agent/src/intelligence/knowledge/knowledge-policy.spec.ts`: mínimo de colaboradores por entorno y umbral de 2/3 con desempate.
- `packages/ai-agent/src/intelligence/knowledge/ai-knowledge.service.spec.ts`: rebuild determinista y bloqueo de un GLOBAL sin evidencia.
- `packages/ai-agent/src/intelligence/knowledge/ai-data-deletion.service.spec.ts`: lápidas elegibles, opt-out, HOLDOUT y runs `INCOMPLETE`.
- `scripts/lib/qa-password.spec.ts`: la contraseña del seed de QA es aleatoria en cada llamada y siempre cumple las cuatro clases de caracteres que exige Supabase.
- `scripts/seed-knowledge-dev.ts` y `scripts/seed-qa-user-dev.ts`: verifican en DEV que la evidencia produce los estados y que un rebuild conserva las filas sin contadores en cero.
- `test/ai-agent.e2e-spec.ts`: JWT, aislamiento de rutas, confirmación de borrado y acceso ADMIN.

Contrato HTTP: [http.md](../contracts/http.md#ai-4-knowledge).

## Datos de QA en DEV

Los dos seeds de Knowledge ya no insertan filas en `ai_knowledge`. Crean la evidencia que lee `knowledge-projector.ts` y ejecutan `AiKnowledgeService.rebuild()` con un ADMIN: si faltan, añaden una conexión de correo inactiva, mensajes, `ai_dataset_items` en `TRAIN`, verificaciones, observaciones, consentimiento y reversiones ADMIN. Repetir el seed no duplica la evidencia y reconstruye la proyección; un rebuild posterior conserva las filas porque vuelve a leer la misma evidencia. Cada seed falla si desaparece un estado esperado o si una clave GLOBAL del fixture queda con cero correos.

El script `scripts/seed-knowledge-dev.ts` prepara el corpus del perfil `admin@gmail.com`:

- USER: nueve filas `STABLE` (pagos, suscripciones y alertas) y una `OBSERVED` (plantilla observada).
- GLOBAL: dos `STABLE` de pagos, dos `REVIEW_REQUIRED` de suscripciones (dos etiquetas en empate) y dos `BLOCKED` de alertas (reversión ADMIN). Reutiliza las claves `qa-ai4-*.example` del seed anterior.

El script `scripts/seed-qa-user-dev.ts` prepara `qa-user@personal-os.dev`, sin rol ADMIN:

- USER: nueve filas `STABLE` y dos `OBSERVED` del perfil QA.
- GLOBAL: dos `STABLE` de pagos (QA + admin), dos `REVIEW_REQUIRED` de pendientes (etiquetas en empate) y dos `BLOCKED` de seguridad (reversión ADMIN).
- Crea o actualiza la cuenta en Supabase Auth con el correo verificado; la contraseña aleatoria, de 24 caracteres con minúscula, mayúscula, dígito y símbolo, solo se escribe en `C:\dev\personal\personal-os\qa-user-dev.txt`, fuera del repositorio. Las cuatro clases evitan que Supabase la rechace con `weak_password`.

Por contrato, USER solo produce `OBSERVED` o `STABLE`; `REVIEW_REQUIRED` y `BLOCKED` son GLOBAL y se ven en la cola ADMIN. La cuenta QA ve su conocimiento personal y las filas GLOBAL `STABLE`; las pendientes y bloqueadas quedan para la revisión del ADMIN.

Desde el repositorio, después de `pnpm db:generate` y `pnpm build:packages`, ejecutar en PowerShell:

```powershell
& 'C:\Program Files\nodejs\node_modules\@infisical\cli\bin\infisical.exe' run --env=dev --path=/back -- pnpm exec ts-node -r tsconfig-paths/register scripts/seed-knowledge-dev.ts --dry-run
& 'C:\Program Files\nodejs\node_modules\@infisical\cli\bin\infisical.exe' run --env=dev --path=/back -- pnpm exec ts-node -r tsconfig-paths/register scripts/seed-knowledge-dev.ts
& 'C:\Program Files\nodejs\node_modules\@infisical\cli\bin\infisical.exe' run --env=dev --path=/back -- pnpm exec ts-node -r tsconfig-paths/register scripts/seed-qa-user-dev.ts --dry-run
& 'C:\Program Files\nodejs\node_modules\@infisical\cli\bin\infisical.exe' run --env=dev --path=/back -- pnpm exec ts-node -r tsconfig-paths/register scripts/seed-qa-user-dev.ts
```

Los seeds exigen `NODE_ENV=development`, comprueban marcadores de entorno, reconocen exclusivamente el proyecto Supabase DEV por su huella SHA-256 y exigen que la migración de Knowledge esté aplicada antes de escribir. El seed del admin exige que `admin@gmail.com` tenga rol ADMIN; el de QA exige ese mismo ADMIN para la evidencia GLOBAL y deja a `qa-user@personal-os.dev` sin fila en `user_roles`, así que su rol efectivo es `USER`. El seed de QA también necesita `SUPABASE_SERVICE_ROLE_KEY` de DEV, que Infisical ya inyecta con el resto del entorno del back. Solo imprimen conteos de evidencia, filas proyectadas por estado y, en QA, la ruta del archivo de contraseña. La segunda ejecución de cualquiera de los dos es la verificación de rebuild: no crea evidencia nueva y vuelve a exigir los estados.
