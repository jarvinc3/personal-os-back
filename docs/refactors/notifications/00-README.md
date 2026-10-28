# Refactor de frontera de Notifications

Seguimiento: NOTIF-0 en [#245](https://github.com/jarvinc3/personal-os-back/issues/245).

## Diagnóstico

La estructura del paquete en sí está sana: application/domain/infrastructure/presentation, repositorio, processor de colas, gateway WebSocket, adaptadores de push/email y servicio de policy tienen roles claros.

El problema arquitectónico es la frontera de entrada. `NotificationsEventsListener` hoy entiende los payloads de eventos de Finance y su semántica de negocio: estado/origen de transacciones, piernas de transferencias, presupuestos, estados de cuenta, vencimientos de tarjetas, resúmenes semanales, cargos recurrentes, suscripciones y descuadres de saldo. También elige las claves de notificación de Finance y construye copy específico de Finance.

Ese diseño se convertirá en un switch central sobre todos los dominios de Personal OS.

## Responsabilidad objetivo

Notifications pasa a ser un **motor de entrega**.

Es dueño de:

- persistencia y estado de lectura de las notificaciones;
- despacho por canal (`IN_APP`, `PUSH`, `EMAIL`, canales futuros);
- push tokens;
- reintentos de entrega / integración con colas;
- horas de silencio;
- preferencias globales de canal;
- evaluación de la preferencia de notificación del módulo solicitada, mediante un contrato genérico de settings;
- observabilidad de la entrega.

**No** es dueño de:

- qué significa un evento de Finance;
- el copy / la redacción de negocio de Finance;
- los tipos de payload de Finance;
- qué evento de Finance debe notificar;
- la semántica de Agenda/Projects/Health.

## NotificationIntent

Concepto de frontera propuesto:

```ts
type NotificationIntent = {
  userId: string;
  sourceDomain: string;
  type: string;
  preferenceKey?: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  requestedChannels?: NotificationChannel[];
  deduplicationKey?: string;
  occurredAt?: Date;
};
```

El schema exacto queda como detalle de implementación, pero debe ser neutral respecto del dominio.

Un adaptador/factory del dominio construye el intent:

```text
evento/estado de Finance
      |
FinanceNotificationAdapter
      |
NotificationIntent
      |
Notifications
      |
Policy -> persistencia -> despacho
```

## Separación importante

`AiSignal != DomainEvent != NotificationIntent`.

- Signal: la inteligencia detectó un hecho/suceso relevante.
- DomainEvent: ocurrió una transición de estado en un dominio.
- NotificationIntent: un productor solicita comunicarse con el usuario.

Notifications no debe convertirse en el bus de señales.

## Qué se conserva

- operaciones de persistencia/listado/lectura de `NotificationsService`;
- el concepto de `NotificationPolicyService`;
- processor de colas / reintentos;
- entrega por WebSocket;
- infraestructura FCM / push tokens;
- port/proveedor de envío de email;
- lógica de horas de silencio;
- conceptos de idempotencia.

## Ajuste de la policy

La policy actual lee defaults específicos de módulos directamente desde `@personal-os/users`. Tras la limpieza de platform settings, Notifications debe preguntar a un resolvedor genérico de module settings/preferencias si `sourceDomain + preferenceKey` está habilitado. No debe importar constantes de notificación ni defaults de configuración de Finance.

## Fases verificables

### NOTIF-0 — Contrato genérico de intents

Introducir/documentar el contrato de intent neutral respecto del dominio y la frontera de adaptadores, preservando el comportamiento actual.

**Gate:** Notifications puede aceptar un intent de prueba sin ningún tipo de Finance.

### NOTIF-1 — Pipeline de entrega

Enrutar intent -> policy -> persistencia -> despacho por canal. Agregar dedup/idempotencia en la frontera del intent donde haga falta.

**Gate:** un mismo intent no puede crear por accidente notificaciones duplicadas; todos los tests de canales actuales siguen en verde.

### Excepción: eventos de importación por email

Los handlers/copy de `FINANCE_TRANSACTION_IMPORTED` y `FinanceEmailSyncCompletedEvent` no esperan a NOTIF-2: se eliminan junto con FIN-1 (Wave B1), en el mismo paso que retira Gmail de Finance. Si AI-7/FIN-3 necesitan notificar importaciones, lo harán vía `NotificationIntent` producido por Finance.

### NOTIF-2 — Migración del productor de Finance

Mover el copy y el mapeo semántico de Finance fuera de `NotificationsEventsListener` hacia un adaptador/factory de notificaciones propiedad de Finance. Quitar de Notifications los tipos de payload de Finance y los imports de `FINANCE_NOTIFICATION_KEYS`.

**Gate:** el paquete Notifications no contiene handlers de eventos específicos de Finance ni decisiones de copy.

### NOTIF-3 — Desacople de settings

Reemplazar la dependencia directa de defaults específicos de módulos en Users por el contrato de module settings de la plataforma.

**Gate:** Notifications puede evaluar la preferencia de cualquier módulo sin cambios de código para un módulo nuevo.

## No-objetivos

- cambiar el diseño de UI de las notificaciones;
- reemplazar BullMQ;
- reemplazar la infraestructura WebSocket/FCM/Resend solo por simetría arquitectónica;
- hacer que un LLM genere el copy de las notificaciones por defecto.
