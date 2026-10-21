# Notifications Boundary Refactor

## Diagnosis

The package structure itself is healthy: application/domain/infrastructure/presentation, repository, queue processor, WebSocket gateway, push/email adapters and policy service have clear roles.

The architectural problem is the inbound boundary. `NotificationsEventsListener` currently understands Finance event payloads and business semantics, including transaction status/source, transfer legs, budgets, statements, card due dates, weekly summaries, recurring charges, subscriptions and balance drift. It also selects Finance notification keys and constructs Finance-specific copy.

That design will become a central switch over every Personal OS domain.

## Target responsibility

Notifications becomes a **delivery engine**.

It owns:

- Notification persistence/read state;
- channel dispatch (`IN_APP`, `PUSH`, `EMAIL`, future channels);
- push tokens;
- delivery retry/queue integration;
- quiet hours;
- global channel preferences;
- evaluation of the requested module notification preference through a generic settings contract;
- delivery observability.

It does **not** own:

- what a Finance event means;
- Finance copy/business wording;
- Finance payload types;
- which Finance event should notify;
- Agenda/Projects/Health semantics.

## NotificationIntent

Proposed boundary concept:

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

Exact schema remains implementation detail, but it must be domain-neutral.

A domain adapter/factory constructs the intent:

```text
Finance event/state
      |
FinanceNotificationAdapter
      |
NotificationIntent
      |
Notifications
      |
Policy -> persist -> dispatch
```

## Important separation

`AiSignal != DomainEvent != NotificationIntent`.

- Signal: intelligence detected a fact/relevant occurrence.
- DomainEvent: a domain state transition occurred.
- NotificationIntent: a producer requests user communication.

Notifications must not become the signal bus.

## What to preserve

- `NotificationsService` persistence/list/read operations;
- `NotificationPolicyService` concept;
- queue processor/retries;
- WebSocket delivery;
- FCM/push-token infrastructure;
- email sender port/provider;
- quiet-hours logic;
- idempotency concepts.

## Policy adjustment

The current policy reads module-specific defaults directly from `@personal-os/users`. After the platform-settings cleanup, Notifications should ask a generic module-settings/preference resolver whether `sourceDomain + preferenceKey` is enabled. It should not import Finance notification constants or Finance config defaults.

## Testable phases

### NOTIF-0 — Generic intent contract

Introduce/document the domain-neutral intent contract and adapter boundary while preserving current behavior.

**Gate:** Notifications can accept a test intent without any Finance type.

### NOTIF-1 — Delivery pipeline

Route intent -> policy -> persistence -> channel dispatch. Add dedup/idempotency at the intent boundary where needed.

**Gate:** same intent cannot accidentally create duplicate user notifications; all current channel tests remain green.

### NOTIF-2 — Finance producer migration

Move Finance copy/semantic mapping out of `NotificationsEventsListener` into Finance-owned notification adapter/factory. Remove Finance payload types and `FINANCE_NOTIFICATION_KEYS` imports from Notifications.

**Gate:** Notifications package contains no Finance-specific event handlers or copy decisions.

### NOTIF-3 — Settings decoupling

Replace direct dependency on module-specific defaults in Users with the platform module-settings contract.

**Gate:** Notifications can evaluate any module preference without code changes for a new module.

## Non-goals

- changing UI notification design;
- replacing BullMQ;
- replacing WebSocket/FCM/Resend infrastructure merely for architectural symmetry;
- making an LLM generate notification copy by default.
