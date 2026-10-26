# Roadmap and Testable Phases

> V1 roadmap, simplified 2026-10-20: 13 phases (0–12). The previous 16-phase plan was compressed: datasets + evidence merged, logical snapshots deferred to V2, review UI completion folded into evaluation, agent runtime and action policy kept separate.

Phase tracking in GitHub: [AI-0 to AI-12 issue index](../00-MASTER-ROADMAP.md#seguimiento-de-fases-en-github).

## Roadmap philosophy

Total architecture replacement implemented incrementally. Legacy is removed rather than carried indefinitely.

Each phase must produce:

1. implementation;
2. automated tests;
3. observable demonstration;
4. explicit acceptance gate.

The next phase starts only after the current phase is demonstrably useful.

## Owner verification through the web

A minimal **Intelligence Review UI** in `personal-os-web` exists from Phase 2 and grows every phase. Labeling (Human Verification) exists **by Phase 3** (required no later than Phase 4). Every demo must be verifiable by the owner in that UI.

## Multi-user from the start

The beta will open to several users who contribute email data. Every phase respects: per-user isolation, GLOBAL/USER scope, contribution consent, and the GLOBAL privacy invariant (`05`).

## Parallel work

Open balance/ledger/planning bugs are fixed in parallel and are out of scope (see `03`).

## Deferred to V2

- logical `AiKnowledgeSnapshot` entities and snapshot diffs;
- selective multi-model consensus;
- month-by-month learning replay;
- multiple datasets / dataset versioning;
- cross-account knowledge _sharing features_ beyond GLOBAL structural knowledge;
- Gmail push/Pub/Sub as the primary sync trigger (V1 keeps the provider-sync boundary compatible with it).

---

# Phase 0 — Controlled reset and clean baseline

## Work

- verify PROD `_prisma_migrations` (read-only);
- reset migration history in repo/DEV; clean Prisma baseline;
- update `AGENTS.md`, `docs/versionado.md`; mark ADR-003/ADR-004 to be superseded;
- bump backend/frontend to `0.100.0` (unreleased);
- define module boundaries;
- preserve financial import/resolution/dedup/reversal/transfer algorithms and their tests; remove dependencies on deleted tables without rewriting financial rules; reconnect in Phase 11;
- remove Gmail-specific legacy email code **and the current chat** (agent runner, tool executor/registry, prompts, chat/sessions/actions endpoints, proactive event listener/processor); keep provider adapters, failover, streaming, Zod schemas and `AiAction` claim/confirm concepts for reuse;
- hide/remove web screens and endpoints listed in `12-REPO-IMPACT.md`;
- ensure project builds from empty DB.

PROD is not touched: it keeps the current version and database until the owner decides the `0.100.0` deploy. Migrations run only against DEV.

## Demo

From an empty DB: install -> migrate -> build -> test -> start.

## Gate

No dependency on removed tables; clean baseline; backend/frontend boot; tests/build green.

---

# Phase 1 — Inference Gateway

## Work

- `AiInferenceGateway`, provider adapters, round-robin/preferred provider, retry/failover;
- structured output + schema validation;
- `AiInference` telemetry foundation;
- build on the provider adapters salvaged in Phase 0;
- migrate every remaining LLM caller: `quick-entry/infrastructure/ai-quick-entry.extractor.ts`, `statements/infrastructure/ai-statement.extractor.ts`.

## Tests

Success, provider failure, retryable failure, fallback, preferred provider, structured output validation.

## Demo

Diagnostic harness shows task, provider/model, result, latency, fallback/error.

## Gate

No package imports a concrete provider. Quick-entry and statement import still work end-to-end.

---

# Phase 2 — Roles, Gmail Source, persistent corpus and consent

## Work

- diagnose OAuth failures;
- `AiEmailConnection` (per user), historical bootstrap from 2026-01-01, incremental cursor design;
- after bootstrap, use **scheduled incremental polling** as the V1 discovery trigger (configurable interval; initial operational target approximately 5–15 minutes): each tick resumes from the persisted provider cursor/history state and fetches only changes/new messages rather than re-querying broad date ranges;
- keep the incremental-sync use case trigger-agnostic so Gmail push via Google Cloud Pub/Sub can later wake the exact same pipeline without redesigning Email Intelligence; Pub/Sub is optional/deferred and is not a `0.100.0` release dependency;
- preserve scheduled reconciliation/recovery even if push is enabled later; correctness depends on persisted cursor + idempotency, not reliable delivery of a cron tick or push notification;
- define recovery for missed runs and invalid/expired provider history cursor, including bounded recovery/full resync;
- `AiEmailMessage` + content (raw/sanitized/canonical), fingerprints, idempotency;
- strict per-user isolation in repositories/queries;
- **roles layer**: `UserRole` table (one role per user: USER | CONTRIBUTOR | ADMIN, default USER; owner seeded as ADMIN in DEV), `@Roles()` decorator + `RolesGuard` registered after the existing global `JwtAuthGuard` (Supabase JWT), role loaded from DB by `userId` (short cache); admin endpoints to list/change roles;
- user setting `contributeToGlobalKnowledge` (**default on, opt-out**) + consent timestamp; explanatory screen at Gmail connect;
- raw retention job.

## Tests

OAuth/token lifecycle, pagination, date range, duplicate import, canonicalization, fingerprint stability, retry/errors, **incremental cursor advancement**, no-change scheduled sync, replay/recovery idempotency, invalid/expired cursor recovery, trigger independence, **cross-user isolation** (user A can never read B's messages), consent default on and revocable, role guard (USER blocked from admin endpoints, ADMIN allowed, unknown user -> USER, role change effective without re-login).

## Review UI increment (v0, read-only)

`/intelligence`: connection status, bootstrap counters, message list/detail with representations. Consent toggle in user settings; admin page to view/change user roles.

## Gate

Re-running bootstrap does not duplicate; experiments run without re-fetching Gmail; scheduled incremental sync processes only provider changes; a missed/duplicate trigger cannot corrupt or duplicate corpus state; the provider-sync boundary can accept a future push trigger without changing downstream Email Intelligence; isolation tests green; every admin/intelligence endpoint is covered by the roles guard.

---

# Phase 3 — Dataset, Analysis Runs, Evidence and Human Verification

(Merges former Phases 3 and 4.)

## Work

- one dataset `EMAIL_V1` with `partition` (TRAIN/VALIDATION/HOLDOUT), deterministic per-user stratified assignment; HOLDOUT frozen;
- `AiAnalysisRun` with versions + evidence watermark fields;
- append-only `AiKnowledgeObservation` and `AiHumanVerification` with monotonic sequences and `verifierRole` (ADMIN/USER).

## Tests

Deterministic partition, HOLDOUT freeze, run lifecycle/config persistence, append-only/immutability, sequence ordering, provenance completeness, correction/rejection.

## Review UI increment (v1, labeling) — required by Phase 4 at the latest

Review queue; Confirm / Correct / Reject writing `AiHumanVerification`; quick labels (relevance, semantic type, routes, transaction yes/no + amount/currency/date); HOLDOUT labels marked as ground truth; runs list.

## Demo

Email -> Observation -> Human Verification, full provenance visible in the UI.

## Gate

Any future knowledge item can be traced to evidence; labeling works from the web.

---

# Phase 4 — Knowledge Engine (scoped, privacy-safe)

## Work

- Knowledge Projector over evidence `<= watermark`;
- single `AiKnowledge` table with `scope` GLOBAL/USER and typed payloads;
- GLOBAL sanitizer (structural only);
- promotion policy: auto-promote to GLOBAL with evidence from >= 2 distinct consenting users OR a CONTRIBUTOR/ADMIN verification; ADMIN revert; anti-feedback;
- user export + deletion with evidence detachment (tombstones);
- degradation; rebuild.

## Tests

Same evidence + versions => same projection; human correction changes projection; **private identifiers/amounts/last4/names never reach GLOBAL** (adversarial fixtures); single-user evidence never promotes without a CONTRIBUTOR/ADMIN verification; USER verification alone never promotes; admin revert; deletion strips personal data and keeps only consent-eligible structural tombstones; historical runs with missing evidence are explicitly INCOMPLETE; export completeness; non-consenting user's evidence ignored for GLOBAL; consent revocation removes contribution on rebuild, unsupported automatic promotions enter REVIEW_REQUIRED and stop automatic use, valid CONTRIBUTOR/ADMIN authorization remains independent; prior revocation is not undone by deletion; clear + rebuild equivalence when evidence remains available.

## Review UI increment

Knowledge explorer (USER items for the user; GLOBAL items + supporting distinct-user count; admin queue of auto-promoted items with revert; user "export / delete my data" in settings).

## Gate

Knowledge is derived, rebuildable and scope-safe.

---

# Phase 5 — Email Intelligence V1

## Work

General relevance detector, finance candidate signals, sender/domain/template knowledge lookup (USER then GLOBAL), template normalization, semantic classification, multi-label routing, deterministic parser interface, single-model LLM fallback + deterministic validation, inference observations, uncertain -> review queue, LLM budget.

## Tests

Known irrelevant/relevant, recall audit sampling (rate, eligibility: admin + consenting users only, no auto-import), OTP vs transaction, stable template, parser success/failure, LLM fallback, prompt-injection email, multi-label route, irrelevant mail produces no inference calls except audit samples, budget stop/resume.

## Review UI increment

Per-message classification, routes, deterministic vs LLM path, knowledge used, provider/model.

## Gate

Email Intelligence works without creating Finance transactions.

---

# Phase 6 — Evaluation + Review UI completion

## Work

`ANALYZE_ONLY` / `EVALUATE`; frozen HOLDOUT; metrics; run comparison. Complete review UI (bulk actions, keyboard flow, filters by uncertainty, re-run from UI).

## Tests

HOLDOUT cannot contribute learning; repeat evaluation with same watermark/versions is comparable; metric calculations; comparison.

## Demo

Run A vs Run B: Transaction Recall, precision, deterministic coverage, LLM fallback rate, unknown rate; review -> rerun -> metric change.

## Gate

Changes can be objectively compared; full human -> evidence -> knowledge -> evaluation loop works from the web.

---

# Phase 7 — Signals

## Work

`AiSignal`, `AiSignalEvidence`, lifecycle/dedup/correlation; explicit outbox-to-BullMQ bridge. The independent pre-reset lease/atomicity fix must already pass its PostgreSQL crash-recovery gate; retain those tests.

## Tests

Creation, multi-signal email, dedup, evidence linkage, lifecycle transitions, per-user isolation.

## Demo / UI

BHD purchase email -> Finance signal visible in the UI, no transaction created.

## Gate

Source intelligence and domains are decoupled.

---

# Phase 8 — Capability Registry

## Work

`AiCapabilityRegistry`, module-owned providers, generic executor, context provider contracts; remove the central tool switch.

## Tests

Register/discover, execute, validation, duplicate names, unavailable module, context lookup.

## Gate

Agent infrastructure no longer imports Finance directly.

---

# Phase 9 — Agent Runtime V2

There is no chat between Phase 0 and Phase 9. **Chat UX is pending the owner's redesign of how web chat works;** this phase must not start UI work until that input exists.

## Work

Orchestrator, context assembler, tool loop, conversation store, capability discovery, inference via gateway, response presentation; conversation summary separated from Knowledge.

## Gate

User asks a Finance question; agent answers via capability without a Finance facade dependency.

---

# Phase 10 — Action Policy

## Work

Evolve `AiAction`: AUTO_ALLOWED / CONFIRM_REQUIRED / FORBIDDEN; preserve pending/claim/race/result semantics.

## Gate

No agent/domain mutation bypasses policy.

---

# Phase 11 — Finance Signal Consumer / IMPORT

## Work

`FinanceSignalConsumer`; reuse extraction, institution/instrument resolution, dedup, reversal, transfer matching, backfill, reconciliation; enable `IMPORT`.

## Tests

Purchase end-to-end, pending, reversal, duplicate financial event, ambiguous instrument, transfer matching, signal idempotency, per-user isolation.

## Demo / UI

Transaction -> signal -> inference -> email traceable in the UI.

## Gate

Finance imports without owning Gmail or generic email intelligence.

---

# Phase 12 — Proactive Intelligence

## Work

Signals -> correlation -> relevance/policy -> optional reasoning -> no-op / suggestion / action.

## Gate

Proactive help without turning every event into an LLM prompt or chat message.

---

## Phase mapping (old -> new)

| Old                                   | New                        |
| ------------------------------------- | -------------------------- |
| 0, 1, 2                               | 0, 1, 2                    |
| 3 Datasets/Runs + 4 Evidence          | 3                          |
| 5 Knowledge Engine                    | 4                          |
| 6 Knowledge Snapshots                 | V2 (V1: watermark on runs) |
| 7 Email Intelligence                  | 5                          |
| 8 Evaluation + 9 Review UI completion | 6                          |
| 10 Signals                            | 7                          |
| 11 Capability Registry                | 8                          |
| 12 Agent Runtime V2                   | 9                          |
| 13 Action Policy                      | 10                         |
| 14 Finance IMPORT                     | 11                         |
| 15 Proactive                          | 12                         |
