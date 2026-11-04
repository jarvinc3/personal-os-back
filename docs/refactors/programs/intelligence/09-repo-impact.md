# Repository Impact, Signals Delivery and Instruction Changes

Status: decisions confirmed 2026-10-24; Phase 0 runtime cut implemented on the isolated `refactor/ai-0` branches.

## PROD impact

None until the owner deploys `0.100.0`. Everything below applies to `develop` and DEV only.

## Updated inventory

The [2026-10-24 inventory](../../archive/reset/02-PHASE-0-INVENTORY.md) includes branch-based data wipe, merchants, Resend delivery, preserved financial algorithms and SQL fingerprints. Refresh it at the exact cut revision.

## Backend endpoints at Phase 0

| Endpoint / code                                                                                                         | Phase 0 action                                                                                                                            | Returns in                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `finance/email-sync/*` (`packages/finance/src/ingestion/**`, `email-sync.controller.ts`)                                | Deleted with all `FinEmail*` models and Gmail scheduler/processors.                                                                       | Phase 2 as AI-owned `AiEmailConnection` endpoints (OAuth/connect/sync/status); Finance import in Phase 11. |
| `ledger/application/import-email-transaction.use-case.ts`                                                               | Preserved with financial tests, without callers until Phase 11. Its candidate port no longer depends on deleted `FinEmail*` models.       | Phase 11 (`FinanceSignalConsumer`).                                                                        |
| `notifications/.../email-sync.processor.ts`                                                                             | Kept: this is notification EMAIL delivery through Resend, not Gmail ingestion.                                                            | —                                                                                                          |
| `ai`, `ai/sessions`, `ai/actions` (chat) + `chat/**`, `tools/**`, `prompts/**`, `runtime/**` in `packages/intelligence` | **Deleted.** Salvage `providers/**`, retry/failover, streaming helpers, Zod schemas and `AiAction` claim/confirm concepts for Phase 1/10. | Rebuilt in Phases 8–10; chat UX pending owner redesign.                                                    |
| `finance/quick-entry`, `finance` statements (`card-statements`, `statement-imports`)                                    | Kept; extractors migrated to the gateway in Phase 1.                                                                                      | —                                                                                                          |

Decided: chat is deleted at Phase 0; no chat in DEV until Phase 9.

## Web (`personal-os-web`, develop) screens at Phase 0

| Area / files                                                                                                                                                                                                                                                  | Phase 0 action                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Finance sync: `src/modules/finance/sync/**` (`mailboxes-view`, `mailbox-group`, `mailbox-sheet`, `email-source-sheet`, `email-source-form`, `link-institution-mailbox-sheet`, `assign-email-message-sheet`, `email-sync-history`, `oauth-gmail-result-sheet`) | Deleted. Gmail connection reappears in the Intelligence screen (Phase 2).            |
| `src/modules/finance/shared/hooks/use-email-sources.ts`, email types in `shared/types/{api,entities}.ts`, `finance-query-options.ts`, `src/shared/constants/api-endpoints.ts`                                                                                 | Remove email-sync endpoints/types/queries.                                           |
| `institutions/institution-detail-screen.tsx` (linked mailboxes)                                                                                                                                                                                               | Remove mailbox section.                                                              |
| `transactions/components/transactions-list.tsx` (email-origin badge/notes)                                                                                                                                                                                    | Keep rendering existing source field if present; remove email-message links.         |
| `settings/finance-module-settings-form.tsx` (sync schedule settings)                                                                                                                                                                                          | Remove Gmail sync schedule fields.                                                   |
| Chat: `src/modules/ai/**`, `app/(app)/chat/page.tsx`, chat launcher in `app/(app)/layout.tsx`                                                                                                                                                                 | Hidden/removed (route, launcher, sockets, hooks). New chat UI awaits owner redesign. |
| Quick entry, card statements, `app/(app)/finance/statement-imports/[importId]`                                                                                                                                                                                | Unchanged.                                                                           |
| New: `app/(app)/intelligence/**`                                                                                                                                                                                                                              | Created in Phase 2 (review UI v0), labeling by Phase 3.                              |

Web and backend must ship `0.100.0` together.

## Signals vs existing outbox / BullMQ

Current infrastructure: `DomainEventOutbox` (ADR-002) dispatches through `EventEmitter2`. BullMQ processors exist downstream; there is no generic outbox-to-BullMQ bridge yet. The independent pre-reset outbox fix is specified in [implementation decisions](../../03-implementation-decisions.md).

**Decided:**

- `AiSignal` is its own table: the durable, queryable record with lifecycle (`DETECTED … CONSUMED/FAILED`), dedup/correlation keys and evidence links. The outbox is not a substitute because it is a delivery log, not domain state.
- Delivery reuses the existing outbox: when a signal reaches `ROUTED`, insert a `DomainEventOutbox` row (`ai.signal.routed`, signalId) in the same transaction; an explicit bridge added in Phase 7 publishes to BullMQ; `FinanceSignalConsumer` processes it idempotently by `signalId` and updates the signal state.
- No new queue technology. Rejected alternatives: signals only as outbox events (no lifecycle/review), or direct in-process calls (couples AI to Finance).

## ADRs

- `ADR-003-email-transaction-dedupe.md` — mark **To be superseded** (Finance-owned email dedupe disappears; replaced by message idempotency + financial-event dedup).
- `ADR-004-configurable-gmail-sync-schedule.md` — mark **To be superseded** (sender-filtered schedule replaced by bootstrap + cursor sync).
- New ADR (next free number, e.g. `ADR-008-ai-intelligence-layer.md`): AI as cross-cutting intelligence layer; email as AI-owned source; Signals boundary and delivery; Knowledge as projection of evidence.
- Optional ADR for the migration baseline reset.

## Repository instruction changes

### `docs/versionado.md`

- Document the one-off jump to `0.100.0` for backend and web as an architecture reset.
- Intermediate commits during Phases 0–12 do not bump the version or create releases; they accumulate under an `Unreleased — 0.100.0` CHANGELOG section described coherently (not per phase).
- Decided: `0.100.0` is deployed to PROD only after Phase 11 (Finance import restored); the owner executes the deploy.

### `AGENTS.md`

- Migration baseline reset is allowed once in Phase 0 (DEV only), after read-only check of PROD `_prisma_migrations`.
- Agents never apply migrations to PROD.
- Reference this context pack as mandatory reading for AI/email work.
- Commits keep `Closes #N`; each phase tracked by its own issue in GitHub Project 3.
- Open Finance bugs continue in parallel and are not blocked.

## Auth and roles integration

Current auth (from code, `packages/auth`, `packages/core`):

- Supabase Auth issues JWTs; the backend verifies them with a Passport strategy `supabase-jwt` (`packages/auth/src/infrastructure/strategies/supabase-jwt.strategy.ts`, `supabase-jwt-verifier.service.ts`, JWKS via `jwks-rsa.loader.ts` / `jwks-secret-provider.ts`).
- `JwtAuthGuard` (`packages/core/src/guards/jwt-auth.guard.ts`) is a global `APP_GUARD` in `core.module.ts`, together with `EnabledModuleGuard` and `CustomThrottlerGuard`.
- `supabase-admin.service.ts` handles admin operations (e.g. auth user deletion via `auth-deletion-outbox.processor.ts` in `packages/users`).
- Prisma `User` has no role field today. A stale compiled `packages/core/dist/guards/roles.guard.d.ts` exists without source — remove or replace it.

Phase 2 integration:

- add `UserRole` Prisma model and a `RolesService` (load by `userId` from the verified JWT `sub`, short in-memory cache invalidated on change);
- add `@Roles(...)` decorator + `RolesGuard` in `packages/core/src/guards/`, registered as `APP_GUARD` **after** `JwtAuthGuard`; routes without `@Roles` behave as today;
- missing row = `USER`; owner seeded as `ADMIN` in DEV (PROD seeding done by the owner at deploy);
- admin endpoints: list users with roles, change role (ADMIN only);
- optional later: mirror role into Supabase `app_metadata` / JWT claims as a cache; DB stays authoritative;
- no Supabase Postgres roles/RLS involvement.

Web: role exposed via `GET /users/me`; admin pages (roles, GLOBAL promotion queue) hidden for non-admins, but enforcement is backend-only.

## User export and deletion

- `GET /users/me/export` (AI/email data bundle) and deletion flow extending the existing user deletion outbox: delete `AiEmail*`, USER knowledge, mappings, verification payloads; detach/tombstone observations supporting GLOBAL; rebuild affected GLOBAL projections.
