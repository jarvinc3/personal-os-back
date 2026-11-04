# NOTIF-0 — Contrato de NotificationIntent

**Issue:** [back #245](https://github.com/jarvinc3/personal-os-back/issues/245)

**PR:** [back #305](https://github.com/jarvinc3/personal-os-back/pull/305)

## Objetivo

Definir y validar un intent neutral respecto del dominio que pueda solicitar una notificación sin tipos de Finance.

## Contrato y gate

La forma conceptual es neutral respecto del dominio:

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

El schema exacto sigue siendo un detalle de implementación. El consumidor reconoce la forma y versión del contrato sin añadir productores ni cambiar todavía el pipeline de entrega. `AiSignal`, `DomainEvent` y `NotificationIntent` siguen siendo tipos distintos.

[Índice de fases de Notifications](README.md).
