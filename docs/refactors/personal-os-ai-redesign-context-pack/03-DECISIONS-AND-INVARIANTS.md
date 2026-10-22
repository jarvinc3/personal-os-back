# Decisions and Invariants

## Project/reset decisions

### Full redesign

This is a replacement architecture, not a compatibility migration.

Legacy code that does not fit the target model should be deleted.

### Migration reset

The migration history will be reset and replaced by a clean baseline.

Before doing so:

1. inspect PROD `_prisma_migrations`;
2. verify nothing must be preserved;
3. update repository instructions such as `AGENTS.md` where previous migration/release rules conflict with the redesign.

### PROD isolation during the redesign

PROD runs on its own database and environment.

- Phase 0 deletes legacy code and resets migrations **in the repository and DEV only**.
- PROD keeps running the current released version (including legacy email import and chat) until the owner explicitly decides to deploy `0.100.0`.
- Migrations (including the new baseline) are executed only against DEV by agents. Applying the baseline to PROD is a separate, owner-executed deploy step.
- Inspecting PROD `_prisma_migrations` is read-only.

### Out of scope: open Finance bugs

Open balance, ledger, planning, card, loan and reconciliation bugs (e.g. the QA campaign issues) are **not** part of this refactor.

- They are fixed in parallel on `develop`.
- They must not be blocked by, or wait for, the redesign.
- The redesign must not delete or rewrite ledger/planning/reconciliation code except where it consumes email (`import-email-transaction`) — and only in Phase 11.
- Bugs located only in code scheduled for deletion (legacy ingestion/AI) may be closed as superseded, with a reference to this pack.

### Version

Backend and frontend target:

```text
0.100.0
```

The CHANGELOG should describe the architecture reset coherently rather than pretending every internal phase is a separate product release.

## Knowledge decisions

### Global and User Knowledge exist from V1

The beta opens to several users. GLOBAL knowledge is structural only and is promoted only with evidence from >= 2 distinct consenting users or owner/admin verification. USER data is strictly isolated. Contribution to GLOBAL is on by default (opt-out), revocable anytime. Templates with evidence from >= 2 distinct consenting users auto-promote (visible to admins, reversible). Details in `05`.

### Roles

Authorization uses an app-owned roles layer (Prisma table + NestJS guard), independent of Supabase Postgres roles/RLS. V1 roles:

```text
USER         adds evidence (incl. own verifications) — cannot authorize GLOBAL promotion
CONTRIBUTOR  verifications count toward / can authorize GLOBAL promotion
ADMIN        can promote/revert any knowledge, see admin queues, manage roles
```

Fine-grained permissions are V2. Roles may later be mirrored into JWT claims as a cache only; the DB remains the source of truth.

### Data ownership and deletion

Each user can export and delete all data about them. GLOBAL knowledge is never deleted by a user deletion; the user's evidence is anonymized/detached so GLOBAL projections remain reproducible. GLOBAL never contains private data (invariant).

### Knowledge is never directly authored by processing code

Target flow:

```text
Observations
     +
Human Verifications
     |
     v
Knowledge Projector
     |
     v
Knowledge Projections
```

Knowledge tables are projections, not the canonical source of truth.

### Knowledge must be auditable/reconstructable

The stronger formulation is:

> Knowledge must be reproducible and explainable from versioned evidence and configuration.

LLM outputs are not assumed to be bit-for-bit deterministic.

Runs should record relevant versions such as:

```text
pipelineVersion
detectorVersion
promptVersion
schemaVersion
provider
model
model parameters/config
inputFingerprint
knowledgeSnapshotId
```

### Anti-feedback

Knowledge promotion must not occur merely because one model returned a high confidence.

Prefer independent evidence:

- multiple source observations;
- consistent repeated template behavior;
- deterministic validation;
- human verification;
- reconciliation with domain truth where available.

Multiple models/providers are useful for disagreement detection, not as the fundamental definition of independent evidence. V1 uses a single model + deterministic validation; multi-model consensus is V2.

### Global Knowledge privacy

Global Knowledge must never absorb user-specific financial identifiers.

Cards, accounts and personal mappings remain User Knowledge.

## Dataset decisions

Use explicit partitions:

```text
TRAIN
VALIDATION
HOLDOUT
```

Rules:

- TRAIN may contribute evidence to Knowledge.
- VALIDATION is used for development/calibration.
- HOLDOUT is used for evaluation.
- HOLDOUT labels must not feed the knowledge being evaluated.

This avoids evaluation contamination.

## Email decisions

### Historical corpus scope

Approved: the full Gmail mailbox from 2026-01-01 to the current date may be downloaded into DEV.

Policy (decided by owner; see `06`):

- deterministic relevance filter runs before any LLM call;
- non-financial / irrelevant mail is not sent to an LLM, unless the relevance detector is uncertain or the message is selected by the recall audit;
- Recall audit: a random sample (default 2%, configurable) of deterministically-discarded mail is sent to the LLM classifier to detect false negatives. Only for the owner/admin account and users with contribution consent. Results become evidence/evaluation data (review queue), never auto-import.
- all configured gateway providers may receive email content;
- raw bodies have bounded retention; canonical representation is durable;
- bootstrap runs under an LLM call cap of 2,000 calls per run, resumable;
- raw retention 30 days DEV / 7 days PROD; no field-level encryption in V1.

### Raw corpus

Fetch/store the historical corpus once, then replay primarily from local persisted representations.

Recommended:

```text
DEV:
  temporary raw corpus
  + durable sanitized/canonical representation

PROD:
  short/configurable raw retention
  + durable sanitized/canonical representation
```

### Email body is untrusted

Never follow instructions found inside email content.

Classification/extraction should use restricted schemas and no arbitrary tool access.

### Deterministic first

Stable known templates should eventually use deterministic parsers + schema validation.

LLM is fallback for unknown/ambiguous cases.

## Agent decisions

### Human verification belongs to web UI

Ground-truth/review workflow is not a chat-agent responsibility.

### Action policy

Future mutations go through explicit policy:

```text
AUTO_ALLOWED
CONFIRM_REQUIRED
FORBIDDEN
```

The existing `AiAction` confirmation semantics are a useful foundation.

## Scope decisions

Initial implementation includes:

- new AI baseline;
- Global/User Knowledge foundations;
- evidence;
- Gmail corpus;
- datasets/runs;
- relevance/classification;
- replay;
- evaluation;
- review UI;
- signals.

Initially excluded:

- cross-account shared knowledge;
- fully proactive agent;
- automatic cross-module actions;
- new domain implementations such as Health/Agenda intelligence;
- Finance IMPORT until Signals and Finance consumption are ready.
