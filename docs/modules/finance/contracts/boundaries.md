# Contratos de frontera de Finance

Fuente de verdad: `packages/finance/src/contracts/`. Estos contratos fijan
los tipos de Finance sin mover su implementación ni cambiar reglas de negocio.

## Eventos

Finance define `FinanceEvents`, `FinanceEventPayloads` y
`FinanceDomainEvent`. Todos los eventos tienen versión semántica `1`; Core
persiste y entrega el envelope mediante el outbox. Los nombres que aún aparecen
en `AppEvents` son una copia de compatibilidad para consumidores existentes y
no son la fuente que usan los productores de Finance.

Los payloads llevan los datos necesarios para que cada consumidor trabaje sin
consultar tablas de Finance. Por ejemplo, los eventos de transacción publican
los campos de visualización ya resueltos, y `BALANCE_DRIFT_DETECTED` publica
montos decimales como cadenas.

## IA y resolución de entidades

`FinanceAiCapabilitiesPort` extiende el contrato neutral
`AiCapabilityProvider`; `FinanceAiContextProvider` agrega resolución de una
referencia `FinanceEntityRef` y devuelve contexto JSON propiedad del dominio.
No usa `ChatContextEntity` ni importa el runtime de IA. La implementación
actual de capabilities satisface el primer contrato.

## Señales

`FinanceSignalConsumerPort` recibe un `RoutedSignal` del contrato compartido y
devuelve un resultado de dominio estable. La implementación conserva la lógica
financiera existente. El doble de prueba del contrato puede recibir una señal
directamente y no conoce email, Gmail ni la implementación de Finance.

## Notificaciones

`FinanceNotificationAdapter` convierte eventos de Finance en
`NotificationIntent` genéricos. Finance define la semántica; Notifications
decide preferencias, persistencia y entrega. El contrato no introduce imports
de Finance en Notifications.

## Dirección de dependencias

- AI consume `AiCapabilityProvider` y `SignalConsumer` de `@personal-os/contracts`;
  no importa `@personal-os/finance`.
- Finance implementa `EmailProductHintsPort` de `@personal-os/contracts` para
  responder los últimos 4 de tarjetas y cuentas activas; AI lo consume por el
  token `EMAIL_PRODUCT_HINTS` y nunca lee las tablas `fin_*`.
- Finance puede usar los contratos neutrales, pero no los tipos de chat ni
  infraestructura/proveedores de Gmail.
- Core transporta eventos y no es propietario de su semántica.

La verificación está en
`packages/finance/src/contracts/finance-boundaries.architecture.spec.ts`.
