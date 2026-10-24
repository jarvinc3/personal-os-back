# Baseline Prisma y SQL

La fuente exacta propuesta es [artifacts/schema.prisma](artifacts/schema.prisma).
No se modifica `packages/database/prisma/schema.prisma` en esta preparación.

## Delta de modelos

| Objeto actual                                                                | AI-0                                             | Razón                                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `AiAgentSession`, `AiMessage`, `AiRole`                                      | Retirar                                          | Conversación se reconstruye en AI-9; se preservan ideas/fixtures, no endpoints ni tablas de chat sin consumidor               |
| `AiAction`                                                                   | Conservar y desacoplar                           | Quitar sessionId/messageId, relaciones e índices correspondientes; dueño directo userId; agregar originType y originReference |
| `AiActionStatus`                                                             | Conservar sin cambios                            | PENDING/RUNNING/SUCCESS/FAILED/CANCELLED y semántica CAS permanecen                                                           |
| `FinEmailConnection`, `FinEmailSource`, `FinEmailMessage`, `FinEmailSyncLog` | Retirar                                          | Su dueño futuro es AI Email; no hay migración de compatibilidad entre fuentes                                                 |
| `FinEmailMessageOutcome`, `FinEmailSyncStatus`                               | Retirar                                          | Enums exclusivos de las tablas retiradas                                                                                      |
| `User`, `Module`, `FinInstitution`                                           | Quitar relaciones inversas retiradas             | Sin cambio de sus campos de negocio                                                                                           |
| `FinTransaction`                                                             | Reemplazar emailMessageId/FK por importReference | Identidad financiera opaca, sin fuente ni dependencia de AI                                                                   |
| `AiSuggestionStatus`                                                         | Conservar                                        | Lo usa FinBudget: su nombre no basta para eliminarlo                                                                          |
| Resto de modelos/enums/decimales                                             | Conservar                                        | Incluye comercios/alias, cobros compartidos, conciliación, FX, outboxes y lease                                               |

La candidata incluye las definiciones completas de los 44 modelos restantes,
con índices, FKs, defaults, precisión decimal y acciones de borrado. No se
introduce un nuevo motor de ledger ni se cambian las reglas de compensación.

## Propiedad de referencias

- `AiAction.userId → User.id` sigue con Cascade. Ningún campo exige una sesión
  o mensaje. El repositorio deberá filtrar por userId directamente; el antiguo
  filtro `session: { userId }` ya no compila y no se reemplaza por un filtro vacío.
- `originType` y `originReference` son contexto del productor, sin FK a tablas
  futuras. No autorizan una operación; la autorización sigue siendo del servidor.
- `FinTransaction.importReference` es `String?`, con unique compuesto
  `(userId, importReference)`. Los movimientos manuales pueden dejarlo nulo;
  no hay relación implícita entre dos nulos.
- Un consumidor futuro genera referencias distintas por movimiento/pierna
  de una señal; Finance recibe la clave final y no interpreta su estructura.
  La idempotencia del consumo completo en AI-11 usa un recibo por señal y
  consumidor, en la misma TX de efectos/outbox. No depende solo del índice de
  una pierna y no escribe directamente la tabla de señales de IA.
- Candidatos pendientes de importe/instrumento/reverso tendrán persistencia
  financiera en FIN-3. En AI-0 sus reglas usan el puerto financiero y fixtures;
  no se agrega una tabla vacía que finja reemplazar el corpus.

## Orden de SQL de una migración limpia

| Orden       | Archivo                     | Propiedad                                                                      |
| ----------- | --------------------------- | ------------------------------------------------------------------------------ |
| 00          | `00-prerequisites.sql`      | Schema public y uuid-ossp                                                      |
| 01          | `01-schema.sql`             | DDL generado por Prisma desde la candidata, sin historia anterior              |
| 02          | `02-invariants.sql`         | 18 CHECKs y 3 índices parciales capturados del fixture migrado actual          |
| 03          | `03-rls.sql`                | RLS en 44 tablas y 23 policies; ownership de acciones ahora por userId         |
| 04          | `04-supabase.sql`           | Triggers, cierre Data API, función Auth privada y bucket logos                 |
| 05          | `05-reference-data.sql`     | Cuatro módulos configurables y 31 categorías de sistema, sin datos de usuarios |
| 06 separado | `06-dev-auth-reconcile.sql` | Bootstrap DEV de perfiles de identidades Auth preexistentes, idempotente       |

Los archivos 00–05 se concatenarán, en este orden, en una migración nueva al
ejecutar AI-0. El nombre usa la fecha UTC real de ese momento: el historial viejo
sale de la ruta activa, así que sus timestamps futuros no fuerzan fechas falsas.
El archivo 06 es un comando DEV de reconstrucción, no parte de una migración
que deba copiar perfiles automáticamente en cualquier entorno.

`supabase-baseline.sql` del historial viejo es una captura de contexto, no SQL
ejecutable; no se concatena. El [manifiesto anterior](../03-BASELINE-SQL-INVENTORY.json)
sirve para trazabilidad, y `artifacts/invariants-manifest.json` describe lo
capturado del catálogo PostgreSQL real del fixture.

## Diferencias deliberadas del SQL específico

- `ai_actions_all_own` usa la columna `user_id`, no un join a la tabla retirada.
- `handle_new_user` vive en `app_private`, con search_path vacío y sin EXECUTE
  de PUBLIC/anon/authenticated. El trigger de `auth.users` mantiene el alta con
  id de Auth, email, nombre y avatar. Metadata de usuario sirve para perfil,
  nunca para roles de autorización.
- Todos los triggers `updated_at` se recrean. Se acepta normalizar su nombre
  a `trg_<tabla>_updated_at`; no se cambia cuándo ni cómo actualizan la fecha.
- Se conserva el cierre de privilegios de #169. RLS no sustituye REVOKE: una
  policy de lectura no vuelve a abrir la Data API sin permisos de tabla.
- El bucket logos conserva límite 1 MB y queda en PNG/JPEG/WEBP; SVG ya está
  rechazado por la aplicación. Esta alineación debe figurar en la revisión del
  corte, no pasar como una copia idéntica de #169.

## Extensiones y schemas administrados

La candidata local usa uuid-ossp en public, como el fixture actual. El preflight
debe confirmar el namespace real en Supabase. Si está en `extensions`, se
ajustan y regeneran defaults con nombre calificado; no se mueve una extensión
administrada ni se asume que `CREATE EXTENSION IF NOT EXISTS` la reubica.

No se redefine la tabla administrada `auth.users`, ni `storage.buckets`, ni las
policies administradas de esos schemas. Los fixtures de validación son solo
para demostrar SQL de integración. Antes del corte se comparan roles, grants,
event triggers (incluido `rls_auto_enable`) y objetos creados fuera de Git.

## Fases futuras

AI-1 agrega `AiInference`; AI-2 agrega roles, settings AI y corpus; AI-3 evidencia
y runs; AI-4 proyecciones; AI-7 señales. Sus modelos completos se diseñan antes
de cada fase con sus invariantes, no se crean todos en esta baseline sin uso.
Los índices parciales GLOBAL/USER y las marcas de consentimiento acordadas
siguen siendo obligatorios en esas fases.
