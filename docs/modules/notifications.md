# Notifications Module

## Scope

In-app, push, and email notification orchestration.

- CRUD-like notification APIs for authenticated users.
- Unread counters and mark-as-read workflows.
- Push token registration/deactivation.
- Queue worker dispatch for channel delivery policies.
- WebSocket gateway for real-time user events.

## Architecture

Simple-module layers under `src/modules/notifications/` (see [docs/architecture/modules.md](../architecture/modules.md)). Root holds `notifications.module.ts` + `index.ts`.

```text
src/modules/notifications/
  notifications.module.ts
  index.ts          # public API
  presentation/     # controller, gateway, dto/
  application/      # service, policy, push-tokens, events listener, notifications processor
  infrastructure/   # repository, push-sender, email-sync.processor (EMAIL stub)
  domain/           # quiet-hours
```

### Public API (`index.ts`)

`NotificationsModule`, `NotificationsService`, `NotificationsGateway`, `PushTokensService`, `NotificationPolicyService`.

Import as `from '../notifications'` (or `src/modules/notifications`).

## Main Endpoints

- `GET /notifications`
- `GET /notifications/unread-count`
- `PATCH /notifications/read-all`
- `POST /notifications`
- `PATCH /notifications/:id/read`
- `POST /notifications/push-tokens`
- `PATCH /notifications/push-tokens/:token/deactivate`

## Queue and Realtime

- Processor: `application/notifications.processor.ts` (queue: `notifications`).
- Gateway: `presentation/notifications.gateway.ts` (socket emits to user channels).
- Policy engine: `application/notification-policy.service.ts` controls quiet hours/channel eligibility.
- Includes `infrastructure/email-sync.processor.ts` stub for email handoff jobs on `email-sync`.
- `NotificationsEventsListener` creates IN_APP notifications from versioned finance events (`finance.transaction.*`, `finance.transaction.updated`, `finance.budget.threshold_crossed`) with idempotency via `DomainEventIdempotencyGuard`.

## EMAIL channel (A1 — stub)

- **Not production-ready.** Real email send is intentionally unimplemented.
- In `production`, `NotificationsService.create` skips queue enqueue for `EMAIL` and logs a warning.
- `EmailSyncProcessor` is a no-op stub that warns on every job; do not treat EMAIL as a live mailer.

## Notes

- Module imports `AuthModule` for secured transport and user context validation.
- Notification payloads are persisted before dispatch attempts.
- `create` emits `notification.created` (not `ai.action_completed`).
- Imports `FinanceEventsModule` only for `DomainEventIdempotencyGuard`; domain payload arrives via EventEmitter2 (no Finance façade dependency).
