# Fronteras de plataforma — Core Events y Module Settings

Seguimiento: PLATFORM-EVENTS-0 en [#243](https://github.com/jarvinc3/personal-os-back/issues/243) y PLATFORM-SETTINGS-0 en [#244](https://github.com/jarvinc3/personal-os-back/issues/244).

Es una limpieza transversal, no una reescritura de Core ni de Users.

## A. Core Events

### Problema actual

Core hoy es dueño de `AppEvents`, que contiene nombres de eventos de User, Finance, Notification y módulos/configuración. Core también contiene clases DTO de eventos específicas de Finance, como eventos de transacciones, presupuestos, email sync y transferencias.

Al mismo tiempo, Finance ya tiene su propia área de paquete `events/` con un port de publicación y un repositorio/dispatcher de outbox. Esto evidencia que la propiedad semántica de los eventos y la infraestructura de transporte están parcialmente repartidas en dos lugares.

### Objetivo

**Core / plataforma compartida es dueña de:**

- primitivas de envelope de eventos;
- abstracciones de almacenamiento/relay del outbox;
- guard de idempotencia;
- infraestructura de colas/transporte de eventos;
- temas genéricos de observabilidad/reintentos.

**Los dominios son dueños de:**

- nombres/tipos de eventos;
- contratos de payload de eventos;
- cuándo se emiten los eventos;
- el versionado semántico de esos contratos.

Ejemplo:

```text
Finance
  FinanceEvents.TRANSACTION_CONFIRMED
  FinanceTransactionConfirmedEvent
          |
          v
publisher/outbox de eventos de la plataforma
          |
          v
Consumidores
```

Core no debería necesitar cambios de código cuando se introduce un evento nuevo de Finance.

### Observación sobre el outbox

El `FinanceOutboxDispatcher` actual consulta directamente la tabla compartida `domainEventOutbox` y despacha todas las filas mediante `EventEmitter2`. Su implementación es genérica pese a su nombre/ubicación de Finance. Debe convertirse en infraestructura de plataforma en lugar de duplicarse para dominios futuros.

### Corrección previa al reset

Leases, fencing y atomicidad del consumidor se entregan primero como hotfix independiente; ver [decisiones](../01-IMPLEMENTATION-DECISIONS.md). PLATFORM-EVENTS-1 conserva esas garantías al mover el relay; AI-7 añade el puente BullMQ explícito.

### Fases

#### PLATFORM-EVENTS-0 — Propiedad de los contratos

Crear ubicaciones de contratos de eventos propiedad de cada dominio y migrar constantes/DTOs sin cambiar el comportamiento del transporte.

**Gate:** las constantes de eventos de Core no contienen el catálogo semántico de Finance.

#### PLATFORM-EVENTS-1 — Relay de outbox genérico

Promover las partes genéricas del dispatcher/repositorio de outbox de Finance a infraestructura de eventos compartida. Los dominios publican mediante un port/envelope compartido.

Decisión: `FinanceOutboxDispatcher` se promueve a Core como `OutboxRelay`, detrás de un port `DomainEventPublisher`. Los use-cases (hoy ~18 en `ledger/application` inyectan el dispatcher concreto) pasan a depender solo del port. El outbox de borrado en Auth de Users (`deleteAccountWithAuthOutbox`) se evalúa por separado; no se fuerza la unificación.

**Gate:** un dominio distinto de Finance puede publicar de forma confiable sin copiar la infraestructura de Finance.

---

## B. Users y Module Settings

### Problema actual

`UsersService` y los defaults del dominio Users hoy conocen una parte importante de la configuración de negocio de los módulos:

- horario y activación del email sync de Finance;
- validación de recordatorios de suscripciones de Finance;
- validación de recordatorios de vencimiento de tarjetas de Finance;
- reglas de destinatarios del resumen semanal de Finance;
- claves de notificación de Finance;
- defaults detallados de Finance, Agenda, Projects y Health.

Esto convierte a Users en dueño semántico de todos los módulos de Personal OS y garantiza que agregar settings de un módulo requiera editar Users.

### Reparto objetivo

**Users es dueño de:**

- identidad/perfil del usuario;
- zona horaria/locale/avatar;
- preferencias globales del usuario;
- orquestación del borrado de cuenta;
- persistencia/asociación de qué módulos tiene habilitados el usuario, si esta sigue siendo la frontera de almacenamiento elegida.

**Cada módulo es dueño de:**

- el schema de sus settings;
- sus defaults;
- su validación;
- migraciones/versionado del payload de su configuración;
- sus claves de preferencias de notificación;
- la semántica de destinatarios/consultas específica del dominio.

**La capa de module settings de la plataforma es dueña de:**

- registro/descubrimiento de los descriptores de settings de los módulos;
- flujo genérico de merge/validación/actualización;
- estado de activación/desactivación de módulos;
- una API de lectura genérica usada por guards/Notifications/IA;
- el adaptador de persistencia a `UserModule`, si se conserva.

Contrato conceptual:

```ts
interface ModuleSettingsProvider<TConfig> {
  slug: string;
  version: number;
  defaults: TConfig;
  validate(input: unknown): TConfig;
}
```

La API exacta se define en el diseño de implementación. Interfaces y tokens genéricos viven en `@personal-os/contracts`, sin dependencias de ejecución Nest/Prisma/SDK. `apps/api` compone los providers. Para las apps sin módulo Nest se registran descriptores estáticos separados; ubicación y transición en [decisiones](../01-IMPLEMENTATION-DECISIONS.md#contratos-y-composición).

### Por qué un registro es preferible a mover todos los defaults a otro archivo central

Mover `DEFAULT_MODULE_CONFIG_BY_SLUG` de Users a Core conservaría el mismo acoplamiento con otro nombre. Los módulos deben registrar sus descriptores; la capa de plataforma no debe codificar sus campos.

### Interacción con roles/consentimiento de IA

El roadmap de IA propone roles y `contributeToGlobalKnowledge`. Los roles son temas de autorización/cuenta y pueden vivir en servicios de plataforma orientados a Users/Auth, como ya está planeado. El consentimiento de contribución a la IA es una preferencia de IA/privacidad; su schema semántico debe ser propiedad de la IA aunque se persista mediante la infraestructura genérica de settings de usuario/módulo.

### Fases

Mientras tanto (web #216/#217): no se agregan claves nuevas a Users; un backend de "Vaciar datos" vive como endpoint dentro de cada módulo.

#### PLATFORM-SETTINGS-0 — Contrato/registro de module settings

Definir el descriptor de provider + registro + interfaz genérica de lectura/validación/actualización. Registrar los módulos existentes sin cambiar la forma de los datos persistidos.

**Gate:** agregar un módulo de prueba con settings no requiere editar los defaults/switches de Users.

#### PLATFORM-SETTINGS-1 — Mover la semántica de los módulos

Mover los defaults y validadores de Finance/Agenda/Projects/Health a sus módulos dueños. Mover las claves de notificación de Finance junto con Finance. Quitar de `UsersService` los métodos específicos de Finance.

**Gate:** Users no contiene parsing/validación/métodos de consulta de configuración específicos de Finance.

#### PLATFORM-SETTINGS-2 — Migración de consumidores

Migrar la policy de Notifications, el guard de módulo habilitado y los schedulers/destinatarios a contratos genéricos de settings o a consultas propiedad del dominio, según corresponda.

**Gate:** Notifications no importa desde Users defaults específicos de módulos.

## Se conserva explícitamente

- la frontera de Supabase Auth;
- el comportamiento de borrado de cuenta/outbox de Users, salvo que el borrado de datos de IA requiera extenderlo;
- la API de perfil de usuario;
- la persistencia existente de `UserModule` puede mantenerse si funciona con el registro;
- guards/colas/observabilidad de Core no relacionados con la propiedad semántica.
