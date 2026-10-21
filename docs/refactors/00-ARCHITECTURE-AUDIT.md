# Personal OS — Architecture Boundary Audit

Status: draft audit based on `develop` before implementation.

## Purpose

This document coordinates refactors that cross package boundaries. It does not replace the detailed AI roadmap. Each domain keeps its own roadmap when the audit finds enough independent work to justify one.

## Audit rule

For every component classify it as:

- **KEEP** — ownership and responsibility are sound.
- **REFACTOR** — owner is correct, internal/public API needs cleanup.
- **MOVE** — useful behavior exists under the wrong owner.
- **DELETE** — legacy behavior should not survive the clean baseline.
- **REDESIGN** — responsibility/boundary itself is wrong.

## Confirmed findings

| Area | Component | Decision | Target |
| --- | --- | --- | --- |
| AI | Email/Gmail ownership | REDESIGN | AI Intelligence owns source/corpus/intelligence; domains consume signals |
| Finance | Core domain modules (ledger, catalog, planning, analytics, reconciliation, etc.) | KEEP | Finance |
| Finance | `ingestion/**` Gmail/source/classification responsibilities | MOVE/DELETE | AI Email Intelligence |
| Finance | finance-specific ingestion behavior (instrument resolution, reversals, transfer matching, ledger import) | MOVE/REFACTOR | Finance signal consumer/application services |
| Finance | `FinanceFacade` as broad AI/external API | REFACTOR | Consumer-specific contracts/capabilities |
| Finance | chat-context concepts | MOVE | AI capability/context integration |
| Notifications | policy/channel/delivery infrastructure | KEEP | Notifications |
| Notifications | `NotificationsEventsListener` finance semantics/copy construction | REDESIGN | Domain-owned notification intent adapters + generic Notifications delivery |
| Core | outbox/idempotency/queue primitives | KEEP | Core/shared infrastructure |
| Core | global `AppEvents` catalog and domain event DTOs | REFACTOR/MOVE | Event semantics owned by domains; Core keeps transport primitives |
| Core | `src/ai` chat-specific contracts | MOVE/DELETE | AI package under new architecture |
| Users | identity/profile/global preferences | KEEP | Users |
| Users | Finance validation/defaults/notification keys/email-sync methods | MOVE/REDESIGN | Module-owned settings contracts; Users persists/coordinates user module settings |
| Auth | Supabase authentication boundary | KEEP | Auth |
| Config | Gmail schedule configuration | DELETE/MOVE | AI source sync configuration if still needed by new cursor design |

## Evidence from develop

### Finance

Finance is already decomposed into domain-focused submodules and should not be rebuilt wholesale. The problematic boundary is concentrated around email ingestion, chat/AI integration and the broad facade.

The current ingestion subtree mixes Gmail scheduling/OAuth/source persistence, LLM extraction, routing, ledger targeting, reversal recovery, transfer matching and backfill. These responsibilities must be separated instead of moved as one block.

### Notifications

`NotificationsEventsListener` currently defines Finance payload types, interprets Finance statuses and transfer legs, builds Finance-specific copy and knows Finance notification setting keys. This will grow into a central domain switch as more Personal OS modules mature.

Notifications should own persistence, delivery, channels, read state and delivery policy. Domain semantics should enter it through a generic `NotificationIntent` contract.

### Core Events

`packages/core/src/events/event.constants.ts` currently contains User, Finance, Notification and module/preferences event names, while `domain-events.ts` contains Finance-specific event DTOs. Core should own event infrastructure, not the semantic catalog of every Personal OS domain.

The existing outbox/idempotency infrastructure is useful and should be preserved. Event contracts should migrate to their owning domains while continuing to use shared delivery infrastructure.

### Users / module settings

`UsersService` currently validates Finance email sync schedules, Finance subscription/card reminder settings, exposes Finance-email-sync-specific queries and computes Finance weekly-summary recipients. `user-settings-defaults.ts` owns detailed Finance/Agenda/Projects/Health defaults and Finance notification keys.

This is a real boundary issue, not merely naming. Users should remain authoritative for user identity/profile and can persist user-module enablement/configuration, but each module should own its config schema/defaults/validation and notification preference vocabulary.

## Architectural invariants proposed by the audit

1. AI must not import Finance implementation services/facades.
2. Finance must not own Gmail connections or raw/canonical email corpus.
3. Finance must not contain chat-specific concepts.
4. Notifications must not interpret Finance/Agenda/Projects/Health business events directly in a growing central switch.
5. Core must not own the semantic event catalog of all domains.
6. Users must not encode module-specific business validation/defaults.
7. Domain modules own their event contracts, module settings schema/defaults, notification-intent construction and AI capability adapters.
8. Shared infrastructure may transport domain events without owning their meaning.
9. `AiSignal`, `DomainEvent` and `NotificationIntent` remain separate concepts.
10. Cross-module communication uses explicit contracts/adapters rather than broad facades.

## Documentation organization

Detailed work is split by concern:

- `ai-intelligence/` — existing AI + Email Intelligence program (currently stored in `personal-os-ai-redesign-context-pack/`; rename can happen with the implementation reset).
- `finance-boundaries/` — Finance boundary cleanup, not a Finance rewrite.
- `notifications/` — Notification Intent + delivery-engine boundary.
- `platform-boundaries/` — Core Events + Users/module-settings cleanup because these are cross-cutting platform concerns rather than standalone product-domain rewrites.
- `00-MASTER-ROADMAP.md` — dependency/order view across all programs.

## No-redesign areas unless new evidence appears

- Finance ledger/planning/catalog/reconciliation domain behavior.
- Auth boundary.
- Database package as infrastructure.
- Logos package.
- Generic config/env loading.

These may require mechanical changes caused by the new baseline but do not currently justify architecture programs of their own.
