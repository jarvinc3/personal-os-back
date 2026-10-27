# Data Model Direction

Architectural direction, not a final Prisma schema. The final schema is designed immediately before implementation and validated against repository conventions.

> V1 simplification (2026-10-20): single scoped knowledge table, single dataset with partitions, no snapshot table (watermark on runs), multi-user isolation and consent built in.

## Existing concepts retained/evolved

```text
AiAgentSession
AiMessage
AiAction
```

## Users / consent

On the user (or a `UserAiSettings` table):

```text
contributeToGlobalKnowledge   boolean, default true (opt-out)
contributionConsentAt?        timestamp (last change)
```

### UserRole (roles layer)

```text
userId        PK/FK -> User
role          USER | CONTRIBUTOR | ADMIN   default USER
grantedBy?    userId
grantedAt
updatedAt
```

Enforced by a NestJS `RolesGuard` (backend), not Postgres roles/RLS. V2: permissions table / role-permission mapping.

## General AI

### AiInference

```text
id
userId?
sourceType?
sourceId?
runId?
task
provider
model
promptVersion
schemaVersion
inputFingerprint
resultJson
modelConfidence?
latencyMs?
tokenUsage?
estimatedCost?
status
error?
createdAt
```

### AiSignal

```text
id
userId
type
domain
sourceType
sourceId
payload
status         DETECTED | VALIDATED | ROUTED | CONSUMED | DISMISSED | SUPERSEDED | FAILED
priority
confidence?
occurredAt
detectedAt
deduplicationKey?
correlationKey?
createdAt
updatedAt
```

Delivery (proposal, see `12`): signal row + `DomainEventOutbox` row in the same transaction; consumers via BullMQ.

### AiSignalEvidence

Links a signal to: email, inference, knowledge observation, domain event, human verification, other signal.

### AiKnowledgeObservation (append-only)

```text
id
sequence          bigint, monotonic
runId?
userId?           owner of the source data; null after user deletion (detached)
contributorTombstone?  stable non-reversible id kept after deletion for distinctUsers
knowledgeType
knowledgeKey
proposedScope     GLOBAL | USER
sourceType
sourceId
inferenceId?
payload
weight
createdAt
```

### AiHumanVerification (append-only)

```text
id
sequence          bigint, monotonic
userId
verifierRole      USER | CONTRIBUTOR | ADMIN  (snapshot at verification time)
targetType
targetId
verdict           CONFIRMED | CORRECTED | REJECTED
correctedPayload?
notes?
createdAt
```

### AiKnowledge (single projection table)

```text
id
scope             GLOBAL | USER
userId?           required when scope = USER, null when GLOBAL
knowledgeType     EMAIL_SENDER | EMAIL_DOMAIN | EMAIL_TEMPLATE | ENTITY | RELATION | USER_MAPPING
knowledgeKey      e.g. normalized sender, registrable domain, domain|normalized subject
state             OBSERVED | STABLE | REVIEW_REQUIRED | BLOCKED
payload           JSON validated by Zod per knowledgeType
messagesSeen
distinctUsers     GLOBAL only (count, never a list)
humanVerifiedCount
promotedBy        AUTO | CONTRIBUTOR | ADMIN (AI-4 writes AUTO or null)
projectorVersion
policyVersion
normalizerVersion
sanitizerVersion
firstSeenAt
lastSeenAt
updatedAt
```

Use SQL partial unique indexes: `(knowledgeType, knowledgeKey)` WHERE scope = GLOBAL; `(userId, knowledgeType, knowledgeKey)` WHERE scope = USER. Add a CHECK requiring null userId for GLOBAL and non-null userId for USER. A nullable composite unique alone does not prevent duplicate GLOBAL items.

`REVIEW_REQUIRED` disables automatic use whenever the 2/3 vote or `AI_GLOBAL_MIN_CONTRIBUTORS` distinct-contributor threshold is missing. The verifier role does not bypass these thresholds. AI-4 uses append-only ADMIN reversal evidence rather than a `revertedAt` field; see the [AI-4 ADR](13-AI-4-KNOWLEDGE-ADR.md) and the [implemented schema](../../../packages/database/prisma/schema.prisma).

Replaces the previously proposed `AiEmailSenderKnowledge`, `AiEmailDomainKnowledge`, `AiEmailTemplateKnowledge`, `AiKnowledgeEntity`, `AiKnowledgeRelation`, `AiUserKnowledge` and `AiUserEntityMapping` (now `knowledgeType = USER_MAPPING`, scope USER only, with hashed external hints).

GLOBAL payload invariant: structural only (see `05`), enforced by projector sanitizer. `EMAIL_SENDER` is USER only; GLOBAL admits safe `EMAIL_DOMAIN` and `EMAIL_TEMPLATE` keys.

### AiDataset / AiDatasetItem

V1: one dataset row (`EMAIL_V1`).

```text
AiDataset: id, name, purpose, sourceType, createdAt

AiDatasetItem:
  datasetId
  userId
  sourceType
  sourceId
  partition      TRAIN | VALIDATION | HOLDOUT   (HOLDOUT frozen)
  labelStatus
  expectedLabel?
  metadata?
```

V2: dataset versioning / multiple datasets.

### AiAnalysisRun

```text
id
datasetId
mode                  ANALYZE_ONLY | EVALUATE | IMPORT
observationSequence   watermark
verificationSequence  watermark
projectorVersion
policyVersion
pipelineVersion
detectorVersion?
promptVersion?
schemaVersion?
configuration
status
metrics?
startedAt
completedAt
error?
```

Each run also records consent/exclusion revision, reproduction status (`COMPLETE | INCOMPLETE`) and missing-evidence counts. Structural tombstone eligibility captures consent active at deletion; consent revocation is a separate append-only marker, never inferred from a deleted user row.

V2: `AiKnowledgeSnapshot` (named logical snapshots, parent/child diff, configuration hash).

## Email (per-user isolated)

### AiEmailConnection

```text
id
userId
provider
emailAddress
isActive
providerCursor?
initialSyncCompletedAt?
lastSyncedAt?
createdAt
updatedAt
```

OAuth tokens encrypted (follow Gmail auth diagnosis).

### AiEmailMessage

```text
id
userId              denormalized for isolation filters
connectionId
providerMessageId
providerThreadId?
receivedAt
fromAddress
fromDomain
subject
contentFingerprint
templateFingerprint?
relevanceDecision?
relevanceScore?
relevanceSignals?
detectorVersion?
semanticType?
processingStatus
createdAt
updatedAt
```

Unique: `(connectionId, providerMessageId)`.

### AiEmailMessageContent

```text
messageId
rawBody?
sanitizedBody?
canonicalBody?
snippet?
retentionExpiresAt?
```

Email content is never referenced by GLOBAL knowledge.

### AiEmailTemplateParser

Optional initially:

```text
id
knowledgeId        -> AiKnowledge (EMAIL_TEMPLATE, usually GLOBAL)
version
parserType
configuration
isActive
successCount
failureCount
createdAt
updatedAt
```

## Finance ownership

Domain truth remains Finance-owned (`FinInstitution`, `FinAccount`, `FinCard`, `FinTransaction`, …).

`FinEmailConnection`, `FinEmailSource`, `FinEmailMessage`, `FinEmailSyncLog` are removed; responsibilities move to `AiEmail*` or disappear.
