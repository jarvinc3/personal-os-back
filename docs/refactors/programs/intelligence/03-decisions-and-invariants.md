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
- Phase 0 removes Gmail transport, OAuth, schedulers/processors and `FinEmail*` models. Preserve the financial import use cases, institution/instrument resolution, financial deduplication, reversals and transfer matching together with their tests, even without callers until Phase 11. Mechanically decouple their contracts from removed tables; do not rewrite their financial behavior. Phase 11 connects them to `FinanceSignalConsumer`.
- Bugs located only in code scheduled for deletion (legacy ingestion/AI) may be closed as superseded, with a reference to this pack.

### Version

Backend and frontend target:

```text
0.100.0
```

The CHANGELOG should describe the architecture reset coherently rather than pretending every internal phase is a separate product release.

## Knowledge decisions

### Global and User Knowledge exist from V1

The beta opens to several users. GLOBAL knowledge is structural only and requires a winning label with at least 2/3 of the votes and `AI_GLOBAL_MIN_CONTRIBUTORS` distinct consenting contributors (default 3; 1 in development). A CONTRIBUTOR or ADMIN verification cannot bypass either threshold. USER data is strictly isolated. Contribution to GLOBAL is on by default (opt-out), revocable anytime. Only safe domain and template keys can promote; an ADMIN can revert them. The [AI-4 ADR](adr/ai-4-knowledge.md) is authoritative.

### Roles

Authorization uses an app-owned roles layer (Prisma table + NestJS guard), independent of Supabase Postgres roles/RLS. V1 roles:

```text
USER         adds evidence (incl. own verifications); eligible votes can support GLOBAL
CONTRIBUTOR  adds verifications; does not bypass GLOBAL vote/contributor thresholds
ADMIN        adds verifications and can revert GLOBAL, see admin queues, manage roles
```

Fine-grained permissions are V2. Roles may later be mirrored into JWT claims as a cache only; the DB remains the source of truth.

### Data ownership and deletion

The [2026-10-24 decisions](../../03-implementation-decisions.md#evidencia-consentimiento-y-borrado) define consent exclusions, structural tombstone eligibility, review suspension and incomplete historical reproduction; they qualify the reproducibility statements below.

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

### Pilot limits are configuration, not constants

The pilot classification limits belong to environment configuration with measured
defaults; a limit change must not require a deployment of code.

The first PR of #402 (#408) delivered the per-user minute counter shared through
PostgreSQL, the atomic daily cost reservation, the truncation of body, subject
and sender, and the `DISCARDED` state for senders outside the bank list. The
second PR moved every limit to `AI_EMAIL_*` variables with the previous values
as defaults (rhythm, initial budget, daily cap, cost cap and alert ratio,
truncation and the bank sender list) and added the shared per-minute counter per
provider.

Measured in DEV before the change, over 660 successful classifications: 2 655
tokens per email on average, 2 465 on Groq's `qwen/qwen3.8-27b` and 3 506 on
OpenRouter's `deepseek/deepseek-v4-flash`, at roughly 0.0005 USD per email. The
daily per-user cap is therefore expressed in tokens, not calls: 320 000 tokens
per UTC day, around 120 emails. The owner decided that this token cap replaces
the previous 100-call daily cap; the 500-classification initial budget stays in
calls because it is a one-time onboarding promise.

Each provider's contracted RPM belongs to the provider account, so the counter
is shared by every replica and every task (`ai_provider_minutes`). The pilot uses
80 % of the configured RPM (Groq 30, OpenRouter 20). The email batch waits for
the next minute instead of receiving a 429; interactive tasks fail fast so a chat
is never blocked behind the batch.

A sender outside the bank list whose text has no deterministic classification is
`DISCARDED`, never `REVIEW_REQUIRED`: the pending review queue is for real
failures and uncertain classifications.

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

- cross-account sharing features beyond structural GLOBAL knowledge;
- fully proactive agent;
- automatic cross-module actions;
- new domain implementations such as Health/Agenda intelligence;
- Finance IMPORT until Signals and Finance consumption are ready.
