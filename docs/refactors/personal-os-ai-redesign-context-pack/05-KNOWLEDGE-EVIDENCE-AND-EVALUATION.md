# Knowledge, Evidence and Evaluation

> V1 scope (2026-10-20): simplified for speed while keeping multi-user essentials. Items marked **V2** are deferred, not discarded.

## Chosen model (V1): append-only evidence log + projector + sequence watermark

```text
                 SOURCE OF TRUTH (append-only)

          AiKnowledgeObservation
          AiHumanVerification
                   |
                   v
          Knowledge Projector Vn
                   |
                   v
          AiKnowledge (scope = GLOBAL | USER)
                   |
                   v
            fast runtime reads
```

Reproducibility in V1 comes from:

```text
evidence sequence watermark (observationSequence, verificationSequence)
+ projectorVersion
+ policyVersion
```

recorded on every `AiAnalysisRun`, together with the consent/exclusion version. Rebuilding with equivalent available evidence and versions reproduces the projection. After privacy removal, historical reproduction is `INCOMPLETE`, records missing-evidence counts and is excluded from comparisons requiring equivalent evidence. See [implementation decisions](../01-IMPLEMENTATION-DECISIONS.md#evidencia-consentimiento-y-borrado).

**V2:** first-class logical `AiKnowledgeSnapshot` entities (named snapshots, parent/child diff, configuration hash).

## Why

- fast production reads;
- auditability and reversible learning;
- promotion rules can change and projections be rebuilt;
- traceability from knowledge back to evidence;
- minimal machinery for V1.

## Observations

Provisional machine/system evidence. Content is append-only during normal processing; consent/exclusion markers live separately. Privacy deletion is an explicit exception: remove personal content and source links, retaining only eligible structural tombstones.

```text
id
sequence            (monotonic, not UUID order)
runId?
userId              (owner of the source data)
sourceType
sourceId
knowledgeType
knowledgeKey
payload
provider?
model?
promptVersion?
pipelineVersion?
weight
createdAt
```

## Human Verification

Stronger evidence. Outcomes:

```text
CONFIRMED
CORRECTED
REJECTED
```

Verifications never mutate Knowledge directly; they enter the evidence stream. Each verification records the verifier's role at the time (`verifierRole = USER | CONTRIBUTOR | ADMIN`). USER verifications are evidence only; CONTRIBUTOR verifications count toward and can authorize GLOBAL promotion; ADMIN can promote/revert anything.

## Knowledge (single table, scoped)

One `AiKnowledge` table with:

```text
scope = GLOBAL | USER
knowledgeType = EMAIL_SENDER | EMAIL_DOMAIN | EMAIL_TEMPLATE | ENTITY | RELATION | USER_MAPPING
```

instead of separate table families. Type-specific attributes live in a validated JSON payload (Zod schema per `knowledgeType`).

### Global vs User — privacy invariant

GLOBAL knowledge stores **only structural knowledge**:

- sender address/domain -> organization;
- template fingerprint, normalized template (placeholders only), semantic type, route distribution;
- parser configuration for a template.

GLOBAL knowledge **never** contains: amounts, last4/masked numbers, account numbers, personal names, merchant strings tied to one user, references, dates of specific events, email bodies, or any user identifier.

Enforced by:

1. a projector-level sanitizer that rejects GLOBAL payloads containing non-placeholder values;
2. unit tests with adversarial fixtures;
3. GLOBAL rows keep only aggregate counts (`distinctUsers`, `messagesSeen`), never per-user lists.

USER knowledge (cards, accounts, mappings, user-specific senders) stays visible only to that user.

### Promotion to GLOBAL

A structural knowledge item is promoted to GLOBAL **automatically** when:

```text
evidence from >= 2 distinct consenting users
OR
CONTRIBUTOR / ADMIN human verification
```

Auto-promotions appear in the admin queue and can be reverted by an ADMIN (revert = a `REJECTED` admin verification, so it is evidence, not a manual edit).

and only evidence from users with **contribution consent = true** counts. Anti-feedback still applies: one model's high confidence is never sufficient; deterministic validation, repeated consistent template behavior and human verification are the accepted evidence.

### Consent

Each user has a contribution flag, **on by default (opt-out)**, shown in settings and explained at Gmail connect; revocable anytime. Without consent:

- the user's data produces USER knowledge only;
- none of their observations count toward GLOBAL promotion;
- revoking consent appends an exclusion marker and excludes their evidence at the next projection rebuild;
- if an automatic promotion loses its two-contributor support and has no valid CONTRIBUTOR/ADMIN authorization, it enters `REVIEW_REQUIRED` and is unavailable for automatic use until reviewed.

### Export and deletion

- A user can export everything about them: corpus/messages, content, USER knowledge, mappings, observations and verifications they own.
- A user can delete all of it. Deletion removes messages/content/USER knowledge/mappings and the user's verifications' personal payloads.
- GLOBAL knowledge is kept. Observations that supported GLOBAL items are **detached**: `userId` set to null and replaced by a non-reversible tombstone id (so `distinctUsers` stays countable), personal payload fields stripped. Only structural type/template/version and a non-reversible anonymous contributor token may remain. The tombstone is eligible only if consent was active at deletion; prior revocation is never undone. GLOBAL items remain stored, but unsupported automatic promotions enter review and cannot be used automatically. Historical runs with missing evidence are marked `INCOMPLETE`.

### Per-user isolation

Email messages, content, observations, verifications and USER knowledge are always filtered by `userId`. GLOBAL knowledge is the only cross-user surface.

## Dataset (V1)

One dataset (`EMAIL_V1`) with a `partition` field on each item:

```text
TRAIN
VALIDATION
HOLDOUT
```

Rules:

- TRAIN may contribute evidence to Knowledge.
- VALIDATION is used for development/calibration.
- HOLDOUT is **frozen**: membership is fixed once assigned and its labels never feed Knowledge.
- Partition assignment is deterministic (hash of message id) and stratified per user.

**V2:** multiple datasets and dataset versioning.

## Analysis Run

```text
id
datasetId
mode                 ANALYZE_ONLY | EVALUATE | IMPORT
observationSequence  (watermark)
verificationSequence (watermark)
projectorVersion
policyVersion
pipelineVersion
detectorVersion
promptVersion
schemaVersion
provider/model config
status
metrics
startedAt
completedAt
```

`IMPORT` is introduced only after domain signal consumption is ready.

## Evaluation (V1)

Frozen evaluation = HOLDOUT partition + run watermark + versions. EVALUATE runs never write observations eligible for Knowledge.

**V2:** month-by-month learning replay (January learns, February uses January, …).

## Inference in V1

Single model per task + deterministic validation. Uncertain or failed validation goes to human review.

**V2:** selective multi-model consensus for bootstrap/disputed templates.

## Ground truth

```text
AUTO_VALIDATED      (deterministic validation passed)
HUMAN_VERIFIED
RECONCILED
```

Human/reconciled evidence is stronger than model confidence.

## Evaluation priorities

Primary Finance metric: **Transaction Recall**.

Additional: relevance recall, route recall/precision, false-positive/negative transactions, LLM calls per 1,000 emails, known-template coverage, deterministic coverage, LLM fallback rate, review rate, institution/instrument resolution accuracy, cost, latency, provider/model distribution, number of GLOBAL items and their distinct-user support.

Prefer `100% transaction recall + extra candidates` over `fewer LLM calls + missed transactions`.
