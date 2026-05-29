# Notifications Module

## Scope

In-app, push, and email notification orchestration.

- CRUD-like notification APIs for authenticated users.
- Unread counters and mark-as-read workflows.
- Push token registration/deactivation.
- Queue worker dispatch for channel delivery policies.
- WebSocket gateway for real-time user events.

## Main Endpoints

- `GET /notifications`
- `GET /notifications/unread-count`
- `PATCH /notifications/read-all`
- `POST /notifications`
- `PATCH /notifications/:id/read`
- `POST /notifications/push-tokens`
- `PATCH /notifications/push-tokens/:token/deactivate`

## Queue and Realtime

- Processor: `NotificationsProcessor` (queue: `notifications`).
- Gateway: `NotificationsGateway` (socket emits to user channels).
- Policy engine: `NotificationPolicyService` controls quiet hours/channel eligibility.
- Includes `EmailSyncProcessor` stub for email handoff jobs on `email-sync`.

## Notes

- Module imports `AuthModule` for secured transport and user context validation.
- Notification payloads are persisted before dispatch attempts.
