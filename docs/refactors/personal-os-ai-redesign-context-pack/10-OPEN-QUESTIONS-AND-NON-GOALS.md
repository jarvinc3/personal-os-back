# Open Questions and Non-Goals

## High-priority open question: Gmail OAuth

Current authentication reportedly fails frequently.

Before implementing the new connection model, diagnose:

- Google Cloud consent screen publication/testing state;
- requested scopes;
- access type;
- refresh token issuance;
- refresh token persistence;
- whether tokens are overwritten;
- refresh implementation;
- exact Google errors;
- account-side revocation;
- re-authentication UX.

Do not assume the cause before diagnosis.

## Gmail historical retrieval

Scope decided: full mailbox from 2026-01-01.

Confirm the exact historical bootstrap mechanism and pagination behavior for the 2026-01-01 range.

Keep bootstrap separate from incremental cursor/history sync.

## Final Prisma schema

The documents describe conceptual tables, not the final schema.

Before coding, produce a technical schema document containing:

- complete models;
- indexes;
- unique constraints;
- enums;
- FK ownership;
- retention fields;
- evidence sequence strategy;
- deletion behavior.

## Global Knowledge

In V1: structural GLOBAL knowledge aggregated across consenting users (>= 2 distinct users or admin verification). User data is never shared.

## Consent (decided)

Settings toggle + explanatory screen at Gmail connect; **on by default (opt-out)**; revocable anytime (effective at next projection rebuild).

**Risk / TODO:** the privacy notice for beta users must clearly disclose that contribution of structural email knowledge is on by default, what is shared (only anonymous template/sender structure) and how to opt out. Required before inviting beta users.

## GLOBAL promotion (decided)

Auto-promotion with evidence from >= 2 distinct consenting users (or a CONTRIBUTOR/ADMIN verification); visible in the admin queue and reversible by ADMIN.

## Retention and deletion (decided)

Raw 30 days DEV / 7 days PROD. Users can export and delete everything about them. GLOBAL knowledge stays; only structural tombstones with consent active at deletion remain eligible. Prior revocation is never undone. Unsupported automatic promotions enter REVIEW_REQUIRED and stop automatic use. Runs with removed evidence are INCOMPLETE and excluded from equivalent-evidence comparisons. GLOBAL never contains private data.

## Roles (decided)

App-owned roles (USER | CONTRIBUTOR | ADMIN) + NestJS guard; fine-grained permissions in V2; optional JWT-claim mirroring later.

## Deferred to V2

Logical knowledge snapshots, multi-model consensus, month-by-month learning replay, dataset versioning.

## New intelligence domains

Agenda, Projects, Health, Travel, etc. are architectural targets, not part of the initial Email/Finance benchmark implementation.

## Chat

Current chat is deleted in Phase 0. Web chat UX awaits the owner's redesign before Phase 9.

## Proactive agent

Deferred until Signals, capabilities and action policy are mature.

Do not rebuild the old event->prompt approach as the final proactive architecture.

## Finance IMPORT

Deferred until:

```text
Email Intelligence
 -> AiSignal
 -> FinanceSignalConsumer
```

exists.

Do not let Email Intelligence directly create Finance transactions.

## Deterministic parsers

Architecture supports them from the beginning.

It is not necessary to implement parsers for every discovered template immediately.

Start with the interface and use LLM fallback until templates are sufficiently stable.

## Provider routing optimization

Keep round-robin/failover initially.

Task/model performance routing can come later using `AiInference` telemetry.

## Physical package split

The code may initially remain in `packages/ai-agent` with better internal boundaries.

Renaming/splitting into `packages/ai` and `packages/ai-agent` is optional later.

Correct dependencies matter more than package naming.

## Raw email retention duration

Current recommendation:

```text
DEV: temporary raw retention + durable canonical representation
PROD: short/configurable raw retention
```

Decided: raw 30 days DEV / 7 days PROD; canonical durable.

## Email encryption and LLM provider policy (decided)

- No field-level encryption in V1 (DB encryption + bounded raw retention).
- All configured providers allowed; RELEVANT/UNCERTAIN mail by default + 2% recall audit sample (see `06`).
- Bootstrap cap: 2,000 LLM calls per run, resumable.

## Signals delivery mechanism

Decided: `AiSignal` table as record of truth + existing `DomainEventOutbox`/BullMQ for delivery (see `12`).

## Out of scope: Finance bugs

Open balance/ledger/planning bugs are fixed in parallel and are not blocked by this refactor.

## Knowledge confidence

Do not design promotion around one generic floating confidence number. GLOBAL promotion rule is fixed for V1 (>= 2 distinct consenting users OR admin verification).

Prefer observable evidence counts, verification, contradictions, deterministic validation and explicit state transitions.
