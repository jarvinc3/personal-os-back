# Agent Handoff Checklist

Use this before another engineering agent starts implementation.

## Understand the product

- Personal OS is multi-module.
- Finance is only the first mature domain.
- AI must become cross-cutting infrastructure.
- Email is a general source, not Finance-owned.

## Understand the reset

- Legacy email code and the current chat are deleted in Phase 0.
- Existing data may be deleted.
- DEV/PROD are separate.
- Verify PROD migrations before reset (read-only).
- PROD stays on its current version and DB until the owner decides the `0.100.0` deploy; agents run migrations only against DEV.
- Open Finance bugs are out of scope and fixed in parallel.
- New baseline targets version `0.100.0`.

## Do not accidentally preserve these architectural assumptions

Do not rebuild:

```text
Gmail -> FinEmailSource -> sender allowlist -> Finance extractor
```

Do not make Agent core import Finance directly.

Do not make a giant central switch containing every module tool.

Do not treat conversation summary as durable Knowledge.

Do not let LLM confidence directly promote Knowledge.

Do not allow HOLDOUT to teach the system being evaluated.

Do not let Email Intelligence create Finance transactions directly.

## Preserve useful existing concepts

- provider adapters;
- round-robin/failover;
- streaming;
- structured extraction;
- Zod validation;
- `AiAction` confirmation/claim semantics;
- session/message persistence;
- strong Finance transaction extraction logic;
- reversals;
- transfer matching;
- reconciliation;
- fingerprints/dedup ideas.

## Canonical architecture vocabulary

Use these terms consistently:

```text
Source
Observation
Evidence
Human Verification
Knowledge Projection
Knowledge Snapshot (V2; V1 uses evidence watermark)
Dataset
Analysis Run
Inference
Signal
Capability
Action Policy
Agent Runtime
Domain Consumer
```

## Knowledge invariant

```text
Evidence
 -> Projector
 -> Knowledge
```

Never:

```text
processing service
 -> arbitrary UPDATE Knowledge
```

## Evaluation invariant

```text
TRAIN -> may learn
VALIDATION -> tune/develop
HOLDOUT -> evaluate only
```

## Email invariant

```text
Gmail
 -> AiEmail*
 -> Email Intelligence
 -> Signals
 -> Domain Consumers
```

## Finance invariant

```text
Finance owns financial domain truth.
AI owns generic intelligence/source infrastructure.
```

## Phase completion invariant

Every phase requires:

```text
implementation
tests
demo
acceptance gate
```

## Multi-user invariant

```text
per-user isolation always
GLOBAL = safe domain/template structure only; auto-promote with >= 2/3 votes and AI_GLOBAL_MIN_CONTRIBUTORS consenting contributors (3 default, 1 development), without role bypass
consent default on (opt-out), revocable
users can export/delete everything; GLOBAL survives via detached evidence
roles USER | CONTRIBUTOR | ADMIN enforced by backend guard (Phase 2)
```

Read `07-ROADMAP-AND-TESTABLE-PHASES.md` (V1: 13 phases, 0–12) before changing code.

## Owner verification

Every phase from Phase 2 must be verifiable in the web Intelligence Review UI; labeling exists by Phase 3.

## Updated decisions and inventory

Read [implementation decisions](../01-IMPLEMENTATION-DECISIONS.md) and the [updated inventory](../02-PHASE-0-INVENTORY.md). Preserve financial algorithms and their tests through Phase 0; only Gmail ownership is removed. Outbox lease/atomicity is an independent pre-reset fix.

## Before implementation begins

The next technical deliverable should include:

1. exact new Prisma baseline;
2. exact list of AI/email files to delete;
3. exact files to create/replace;
4. dependency graph between modules;
5. Gmail OAuth diagnosis;
6. test matrix for Phase 0/1/2;
7. repository instruction changes (`AGENTS.md`, migration rules, versioning);
8. rollback/rebuild instructions for DEV;
9. web impact list and Signals delivery decision (`12-REPO-IMPACT.md`).

## GitHub safety note from prior analysis

Previous repository review was performed read-only.

Do not assume permission to modify the repository merely because architecture documents exist. Confirm the requested implementation scope before writing/committing changes.
