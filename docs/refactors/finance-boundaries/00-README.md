# Refactor de fronteras de arquitectura de Finance

Seguimiento: FIN-0 en [#242](https://github.com/jarvinc3/personal-os-back/issues/242).

## Alcance

Esto **no es Finance V2** y no reconstruye la lógica de dominio de Finance que está sana. Retira responsabilidades que se filtraron a Finance porque el email y la arquitectura anterior del agente estaban centrados en Finance.

## Fortalezas actuales a conservar

Finance ya está descompuesto en submódulos enfocados: analytics, balance sheet, catalog, FX, integrity, ledger, merchants, planning, quick entry, receivables, reconciliation, recurring, statements, subscriptions y otros. Se conserva su comportamiento de negocio salvo que un bug aparte requiera cambiarlo.

El paquete de eventos de Finance ya contiene un port de aplicación e infraestructura de outbox. Los conceptos de entrega confiable/idempotencia deben sobrevivir aunque cambie el dueño de la infraestructura genérica de despacho.

## Problemas a corregir

### 1. La ingesta de email abarca demasiado

`packages/finance/src/ingestion/**` contiene hoy tanto inteligencia de fuentes como comportamiento legítimo de aplicación de Finance.

**Mover a AI Intelligence:**

- conexión OAuth/fuente de Gmail;
- sync/cursor/bootstrap del proveedor;
- persistencia de email crudo/sanitizado/canónico;
- detección de remitente/dominio/plantilla;
- relevancia/clasificación de emails;
- infraestructura de extracción de emails con LLM;
- revisión/evidencia general de emails.

**Conservar/reubicar dentro de Finance:**

- normalización de transacciones financieras a partir de una señal de Finance;
- resolución de institución/instrumento;
- deduplicación de eventos financieros;
- comportamiento pendiente/final/reverso;
- emparejamiento de transferencias;
- importación al ledger;
- comportamiento de conciliación/backfill realmente financiero.

La nueva frontera de entrada es `FinanceSignalConsumer`, no Gmail.

### 2. `FinanceFacade` es demasiado amplio como contrato entre módulos/IA

El facade delega en vez de implementar toda la lógica de negocio, así que no es un god service interno. El problema es su papel como API pública universal, sobre todo para la IA.

Dirección objetivo:

- los controllers HTTP normales pueden seguir usando servicios de aplicación dentro de Finance;
- la IA usa `FinanceAiCapabilities` / `FinanceAiContextProvider` registrados mediante contratos genéricos de IA;
- la ingesta de señales usa `FinanceSignalConsumer`;
- otros módulos dependen de contratos explícitos y acotados solo cuando sea necesario;
- ninguna capa genérica de IA importa `FinanceFacade`.

Si `FinanceFacade` sigue como facade interno de conveniencia se decide durante la implementación; debe dejar de ser la frontera arquitectónica para todos los consumidores.

### 3. El contexto de chat no es un concepto de Finance

Cualquier servicio de Finance cuya API se exprese en términos de `ChatContextEntity` debe convertirse en un resolvedor de entidades/contexto propiedad de Finance, detrás de un adaptador de capacidad/contexto de IA. Finance puede resolver sus propias entidades; no debe saber que quien llama es un chat.

### 4. La semántica de notificaciones pertenece a Finance; la entrega no

Finance debe decidir cuándo un hecho financiero tiene un mensaje semántico para el usuario y construir un `NotificationIntent` mediante un adaptador/factory de Finance. Notifications es dueño de la policy, la persistencia y la entrega por canales.

### 5. La semántica de los eventos de Finance pertenece a Finance

Los nombres/contratos de eventos de Finance, hoy centralizados en Core, deben pasar a contratos propiedad de Finance. La infraestructura compartida de transporte/outbox sigue siendo infraestructura de plataforma.

## Superficie de integración objetivo

```text
AI Email Intelligence
        |
        v
     AiSignal
        |
        v
FinanceSignalConsumer
        |
        v
 aplicación/dominio Finance
        |
   +----+-------------------+
   |                        |
eventos de dominio     FinanceNotificationAdapter
Finance                     |
   |                   NotificationIntent
transporte compartido       |
                            v
                      Notifications
```

Ruta de conversación con la IA:

```text
Agent Runtime
    |
AiCapabilityRegistry
    |
FinanceAiCapabilities
    |
servicios de aplicación de Finance
```

## Fases verificables

### FIN-0 — Contratos de frontera

Definir los contratos de eventos propiedad de Finance, los contratos de adaptadores de IA de Finance, la frontera `FinanceSignalConsumer` y la forma del adaptador de intents de notificación de Finance. Sin cambios de comportamiento de negocio.

**Gate:** los tests de arquitectura/reglas de imports pueden expresar la dirección de dependencias deseada.

### FIN-1 — Retirar la propiedad legacy de fuentes

Coordinado con las Fases 0/2 de IA: eliminar la infraestructura de Gmail/fuentes propiedad de Finance y los endpoints públicos/dependencias de settings específicos de email. Conservar los algoritmos financieros y sus pruebas como código de aplicación/dominio, aunque temporalmente no tengan llamadores. Desacoplar sus contratos de `FinEmail*` sin reescribir reglas de saldos; fase 11 los conecta a `FinanceSignalConsumer`.

En el mismo paso se eliminan los eventos de importación por email y todo lo que dependa de ellos: `FINANCE_TRANSACTION_IMPORTED`, `FinanceEmailSyncCompletedEvent` (Core `domain-events.ts` / `event.constants.ts`), sus handlers en `NotificationsEventsListener`, el copy asociado en `notification-copy.ts` y las constantes/claves de notificación exclusivas de la importación. No se dejan huérfanos hasta NOTIF-2.

**Gate:** Finance compila sin modelos de Gmail/OAuth/fuentes, y no queda ningún emisor, listener, copy ni constante de eventos de importación por email.

### FIN-2 — Limpieza de la integración pública

Sacar a los consumidores de IA/chat de `FinanceFacade`; reemplazar los tipos de contexto de chat por adaptadores de entidades/contexto de Finance; acotar los contratos externos.

**Gate:** el paquete de IA no tiene ningún import de la implementación/facade de Finance y Finance no tiene ningún import de conceptos de chat.

### FIN-3 — Importación por señales

Coordinado con las fases de Signals/IMPORT de IA. Implementar un `FinanceSignalConsumer` idempotente usando el comportamiento financiero conservado.

Cada movimiento importado en moneda distinta a la del producto guarda el **monto original, la moneda original y la tasa** aplicada, reutilizando la conversión de ledger/FX entregada en back #161.

**Gate:** una señal de Finance enrutada puede crear/actualizar el estado financiero correcto sin que Finance lea un email.

### FIN-4 — Limpieza de propiedad de notificaciones/eventos

Finance publica contratos de eventos propios y crea intents de notificación propiedad del dominio. Se retira de Notifications la interpretación semántica de Finance.

**Gate:** agregar una notificación nueva de Finance no requiere editar un switch central de eventos de Finance en Notifications.

## No-objetivos explícitos

- reescribir Ledger;
- rediseñar budgets/planning;
- reescribir catalog/cuentas/tarjetas;
- cambiar la semántica de conciliación sin evidencia;
- corregir bugs de saldos/ledger no relacionados como parte de este refactor.
