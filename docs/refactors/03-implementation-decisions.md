# Decisiones de implementación previas al reset

Decisiones acordadas el 2026-10-24. Seguimiento: [programa #193](https://github.com/jarvinc3/personal-os-back/issues/193), [outbox #192](https://github.com/jarvinc3/personal-os-back/issues/192) y [drift #194](https://github.com/jarvinc3/personal-os-back/issues/194). Este documento precisa los programas de
`01-master-roadmap.md`; no declara implementadas las fases futuras.

## Corte de Gmail y conservación financiera

En AI-0/FIN-1 se eliminan transporte Gmail, OAuth, schedulers, processors de
Gmail, endpoints de fuente y modelos `FinEmail*`. Se conservan los algoritmos
financieros y sus pruebas: resolución de institución/instrumento, deduplicación
financiera, reversos, emparejamiento de transferencias e importación al ledger.

El código conservado puede quedar sin llamadores hasta AI-11/FIN-3. Tiene un
destino explícito en `FinanceSignalConsumer`. Solo se desacoplan los contratos
que dependan de tablas retiradas; no se reescriben reglas de saldos. Las pruebas
de caracterización deben seguir ejecutándose durante todo ese intervalo.

## Corrección previa del outbox

Es una corrección independiente, anterior al reset y apta para llevarse a la
línea de producción. No espera a AI-7 ni mueve todavía el relay a Core.

- Lease de cinco minutos con `claimedAt`; un lease vencido vuelve a `PENDING`
  o termina en `DEAD` si agotó ocho intentos. También se recuperan filas antiguas
  en `PROCESSING` sin lease.
- Cada claim incrementa `attempts`. El cierre exige el mismo intento y lease;
  un worker viejo no puede cerrar ni fallar un intento posterior.
- La marca de consumidor y sus efectos PostgreSQL se confirman en una misma
  transacción. Un fallo o una caída revierte ambos; no se confunde haber
  reclamado el evento con haberlo procesado.
- Los listeners propagan errores al relay. Las notificaciones IN_APP son
  persistencia durable; el aviso WebSocket se emite después del commit y se
  recupera mediante listado al reconectar.
- Para el encolado externo de IA se usa un job ID estable por usuario,
  consumidor y evento. El recibo se guarda después de encolar. El job se retiene
  para cubrir una caída entre Redis y PostgreSQL; su limpieza solo es segura
  después de comprobar que el recibo correspondiente quedó confirmado.
- Las marcas históricas de la implementación anterior no se borran ni se
  reproducen automáticamente: no es posible distinguir desde ellas qué efecto
  llegó a ocurrir. Una reparación histórica requiere una auditoría aparte.

Gate: PostgreSQL real, concurrencia, rollback, lease activo/vencido/agotado,
worker antiguo y procesos terminados antes/después del commit. La integración
de Signals añade en AI-7 un puente explícito outbox → BullMQ; el relay actual
usa `EventEmitter2`, no publica por sí mismo en BullMQ.

## Contratos y composición

La dirección elegida es `@personal-os/contracts`, con interfaces, tipos y
tokens, sin dependencias de ejecución de Nest, Prisma ni SDKs. Incluirá los
contratos genéricos de capacidades, intents y settings (`AiCapabilityProvider`,
`NotificationIntent`/`IntentProducer`, `SettingsDescriptor`). Los contratos de
eventos financieros siguen perteneciendo a Finance.

Los adaptadores de los dominios, el runtime IA y el delivery Notifications
dependen de esos contratos. `apps/api` registra y conecta las implementaciones;
no se introducen imports entre implementaciones ni ciclos Nest nuevos.

Finance aloja su descriptor. Para Agenda, Projects y Health se conservan
descriptores estáticos separados, registrados desde `apps/api`, sin inventar
módulos Nest. Mientras no existan sus paquetes, viven en archivos separados de
`apps/api/src/module-settings/descriptors/`; cuando exista cada paquete pasan a
`packages/<app>/src/settings.descriptor.ts`. El registro central solo compone
providers, no conoce ni valida campos de negocio.

## Evidencia, consentimiento y borrado

- El contenido de evidencia es append-only durante la operación normal.
  Cambios de consentimiento y exclusiones forman un registro separado,
  versionado, que también debe identificarse en cada run.
- Revocar consentimiento excluye la evidencia del usuario del rebuild que se
  dispara al guardar el cambio (decisión del 2026-10-27); GLOBAL queda en
  revisión si ese rebuild falla. Si una promoción pierde el umbral de 2/3 o el mínimo de
  colaboradores elegibles de `AI_GLOBAL_MIN_CONTRIBUTORS`, pasa a
  `REVIEW_REQUIRED` y deja de utilizarse automáticamente. No se borra.
  Una verificación CONTRIBUTOR/ADMIN tampoco salta esos umbrales; manda el
  [ADR de AI-4](programs/intelligence/adr/ai-4-knowledge.md).
- El borrado elimina contenido personal, identificadores, vínculos a fuentes y
  payloads personales. Puede conservar una lápida estructural con tipo,
  plantilla normalizada, versión y un identificador anónimo no reversible para
  contar contribuyentes distintos. La limpieza por privacidad es una excepción
  explícita al contenido inmutable; no conserva secretos ni hashes de userId.
- La lápida solo es elegible para GLOBAL si el consentimiento seguía vigente
  al borrar. Un consentimiento revocado no se reactiva mediante el borrado.
- Un run cuya evidencia personal se retiró se marca como reproducción
  `INCOMPLETE`, informa conteos de evidencia ausente y no participa en
  comparaciones que requieran evidencia equivalente. No se promete igualdad ni
  similitud del resultado tras ese retiro.
- Cuando la evidencia y la configuración sigan disponibles, la proyección
  conserva su gate de reconstrucción equivalente. Un watermark solo no basta:
  también se registra la versión de las exclusiones/consentimiento aplicadas.
- GLOBAL requiere un índice único parcial por `(knowledgeType, knowledgeKey)`
  donde `scope = 'GLOBAL'`; USER otro por `(userId, knowledgeType, knowledgeKey)`
  donde `scope = 'USER'`. Un CHECK exige userId nulo solo para GLOBAL. Estos
  índices y el CHECK deben figurar en el SQL de la baseline futura.

## Corte de release y prerrequisitos

`develop` partía de `0.55.1` en `a0aa950b1bddcde83ccb6b0551c9a5ea1636290c`.
Esto no prueba la versión desplegada: el `master` local todavía contiene
`1.3.2`. El master remoto consultado el 2026-10-24 está en `0306083`, versión `0.53.3`; tampoco acredita el corte previsto 0.55.1. Antes de AI-0 se verifican el merge y el estado real de producción.

La corrección del outbox lleva su propio PATCH previo al reset. Al hacer el
corte, `release/0.55.x` nace del `master` que contenga la línea estable verificada
(base prevista `0.55.1` más los hotfixes previos aprobados). No se crea desde el
master local antiguo ni se despliega automáticamente.

Solo al iniciar AI-0, back y web pasan a `0.100.0` unreleased. Los commits del
programa acumulan cambios sin release/tag por sesión. El owner decide el deploy
después de AI-11; AI-12 pertenece a `0.101.0`. El reset de migraciones es único,
solo repo/DEV y requiere inspección de PROD de solo lectura y plan de rebuild.

El [inventario archivado](archive/reset/02-PHASE-0-INVENTORY.md) debe refrescarse al SHA exacto del corte.
Antes de resetear faltan el esquema técnico final, diagnóstico OAuth con
evidencia operativa, verificación de PROD y matriz de demo de back/web.
