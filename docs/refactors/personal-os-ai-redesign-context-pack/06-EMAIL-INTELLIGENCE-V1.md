# Email Intelligence V1

## Ownership

Email becomes an AI/Intelligence source.

Target ownership:

```text
AI / Intelligence
  +-- AiEmailConnection
  +-- AiEmailMessage
  +-- provider sync
  +-- relevance detection
  +-- semantic routing
  +-- sender/domain/template knowledge
  +-- signal emission

Finance
  +-- consumes FINANCE.* signals
  +-- finance-specific extraction/validation
  +-- institution resolution
  +-- instrument resolution
  +-- ledger/reconciliation/reversals
```

## Historical corpus

Initial window:

```text
2026-01-01 -> current date
```

Initial known Finance benchmark:

```text
BHD
Banco Popular
Qik
```

Scope approved by the owner: the full mailbox from 2026-01-01 (not only bank senders).

Do not build the dataset only from transactions already detected by the old system. That would preserve the old system's blind spots.

Include:

- known bank emails;
- broad financial candidates;
- rejected samples;
- ideally enough mailbox coverage to measure false negatives.

## Bootstrap vs incremental sync

These are separate mechanisms.

### Historical bootstrap

Fetch messages over the historical date range once to establish the persisted corpus and the initial provider cursor.

### Incremental sync

After bootstrap, normal operation must be incremental. Use Gmail/provider cursor/history semantics rather than institution sender filters or repeated date-range scans.

`AiEmailConnection` should support fields conceptually similar to:

```text
providerCursor
initialSyncCompletedAt
lastSyncedAt
lastRecoverySyncAt
```

The incremental sync pipeline must not depend on how it is triggered. A trigger only wakes the same application use case:

```text
trigger
  -> incremental sync from providerCursor
  -> fetch only provider changes/new messages
  -> persist/canonicalize idempotently
  -> advance providerCursor after successful processing
  -> Email Intelligence
```

### V1 trigger strategy — scheduled incremental polling

For `0.50.0`, the baseline trigger is a scheduler/cron that wakes incremental sync at a configurable interval (initial operational target: approximately every 5–15 minutes).

This replaces the legacy idea of repeatedly querying Gmail by broad time ranges. A scheduled run with no provider changes should finish cheaply without re-reading the mailbox.

The scheduler is infrastructure, not part of Email Intelligence semantics. Email Intelligence must never assume that a cron caused the sync.

### Future trigger — Gmail push notifications

Gmail push via Google Cloud Pub/Sub is an optional later optimization for near-real-time processing. It must be additive, not a redesign:

```text
V1:
cron/scheduler -----------+
                         |
                         v
                  incremental sync
                         |
                         v
                 Email Intelligence

Future:
Gmail -> Pub/Sub ---------+
                         |
                         v
                  same incremental sync
```

Enabling Pub/Sub may require Google Cloud billing/payment configuration even when actual usage remains within free allowances. Therefore Pub/Sub is **not a `0.50.0` release dependency**.

When push is enabled, scheduled polling should remain available as recovery/reconciliation rather than the primary discovery mechanism. Push notifications are wake-up signals; provider history/cursor state remains the source for determining what changed.

### Recovery and cursor failure

The design must tolerate missed triggers, temporary provider/backend downtime and an invalid/expired provider history cursor.

Recovery policy:

1. normal sync resumes from `providerCursor`;
2. periodic reconciliation verifies that incremental state continues progressing;
3. if the provider can no longer serve history from the stored cursor, perform a bounded recovery/full resync according to the provider adapter policy;
4. message idempotency prevents duplicate corpus entries during replay/recovery.

The correctness invariant is: **delivery of a cron tick or push notification is not the durable state; the persisted provider cursor and idempotent corpus are.**

## Message representations

Separate:

### Provider representation

What Gmail returned:

```text
headers
html
plain text
snippet
provider date
```

### Sanitized representation

Remove/normalize irrelevant HTML, trackers, excessive quoted content, etc.

### Canonical representation

Stable intelligence-oriented representation:

```text
normalized sender
normalized subject
normalized body
language?
content fingerprint
template fingerprint
```

Replays should primarily operate on persisted canonical content.

## General relevance detector

The cheap detector is deterministic TypeScript.

Its question is:

> Is this email potentially useful to Personal OS?

Possible signal families:

```text
financial
calendar/date/time
booking/reservation
subscription/billing
delivery/shipping
task/deadline
project/work
health/appointment
security
government/document
purchase/receipt
travel
```

It optimizes recall.

## Semantic routing

Routing is multi-label.

Example:

```json
{
  "semanticType": "TRAVEL_BOOKING_CONFIRMATION",
  "routes": [
    { "domain": "TRAVEL", "score": 0.99 },
    { "domain": "CALENDAR", "score": 0.96 },
    { "domain": "FINANCE", "score": 0.78 }
  ]
}
```

## Finance candidate detector

For the initial benchmark, useful deterministic signals include:

Positive:

```text
known financial sender/domain/template
RD$/DOP/US$/USD amount
purchase/consumo
transfer
deposit/payroll
withdrawal
debit/credit
refund/reversal
masked card
account ending
authorization/reference
```

Negative:

```text
OTP
login/security
marketing
newsletter
terms update
generic statement notice
```

Negative signals generally reduce score rather than immediately hard-reject.

## Template knowledge

Sender alone is insufficient because the same institution may send:

- purchases;
- OTP;
- marketing;
- statements;
- security alerts.

Normalize templates.

Example:

```text
Se realizó un consumo por RD$ 850.00
con su tarjeta terminada en 4821
en SUPERMERCADO NACIONAL
```

becomes approximately:

```text
Se realizó un consumo por {AMOUNT}
con su tarjeta terminada en {LAST4}
en {MERCHANT}
```

Template lifecycle:

```text
UNKNOWN
OBSERVED
STABLE
DEGRADED
```

Sender lifecycle:

```text
UNKNOWN
OBSERVED
TRUSTED
DEGRADED
BLOCKED
```

## Deterministic parser

Stable templates may eventually execute:

```text
known stable template
  -> deterministic parser
  -> Zod/schema validation
  -> structured result/signals
```

Failure:

```text
parser failure -> LLM fallback
```

## LLM role

LLM interprets unknown/ambiguous content.

It must not become the persistent memory system.

Store provider/model with inference observations.

V1: single model + deterministic validation; uncertain results go to human review.

V2 — use multi-model consensus selectively for:

- bootstrap;
- ambiguity;
- disputed templates;
- evaluation samples;
- important knowledge promotion.

Do not average provider confidence as if models were calibrated identically.

## Finance-specific extraction

Reuse/refactor strong parts of the existing extractor:

```text
transaction
pending_amount
not_transaction
amount
currency
transaction date
merchant
movement class
status
bank reference
instrument hint
last four
account hints
payroll fallback
```

## Institution and instrument resolution

Institution is resolved after discovery, not before Gmail fetch.

Evidence may include:

```text
sender
domain
template
branding/text
model extraction
historical knowledge
```

Instrument resolution then uses:

```text
institution
instrument hint
last four
account hint
user mappings
```

Possible result:

```text
RESOLVED
AMBIGUOUS
UNKNOWN
```

Ambiguous/unknown cases go to review rather than silent assignment.

## Deduplication

Separate:

### Message idempotency

```text
emailConnectionId + providerMessageId
```

### Financial event deduplication

Use available evidence such as:

```text
institution
instrument
amount
currency
merchant
bankReference
date/time bucket
movementClass
```

Do not assume every email is a distinct financial event.

## Security

- Email content is untrusted.
- Never follow instructions embedded in the email.
- No arbitrary tools during classification/extraction.
- Schema-constrained outputs.
- Validate amounts/dates/currency.
- Display name is not sender identity.
- Use authentication metadata when available.
- Protect against knowledge poisoning.

## Privacy and cost policy (decided)

Decided by the owner on 2026-10-20. Values are configurable via env.

| Topic               | Default                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Order of processing | Canonicalize -> deterministic relevance detector -> (only if relevant or uncertain) LLM.                                                                                                                                                                                                               |
| LLM exposure        | By default only `RELEVANT` or `UNCERTAIN` messages reach inference.                                                                                                                                                                                                                                    |
| Recall audit        | Recall audit: a random sample (default 2%, configurable) of deterministically-discarded mail is sent to the LLM classifier to detect false negatives. Only for the owner/admin account and users with contribution consent. Results become evidence/evaluation data (review queue), never auto-import. |
| Minimization        | Send the canonical body (trackers, quoted history, signatures and long footers stripped), truncated to a configured max length. No attachments.                                                                                                                                                        |
| Providers           | All providers configured in the gateway are allowed; record provider/model per inference. Per-task allowlist remains possible.                                                                                                                                                                         |
| Raw retention       | DEV: raw body kept up to 30 days, then purged; PROD: 7 days. Canonical/sanitized content and fingerprints are durable. Configurable via env.                                                                                                                                                           |
| Encryption          | OAuth tokens encrypted at rest (keep current token-encryption utility). Raw/canonical bodies stored in the app DB with DB-level encryption; no field-level encryption in V1.                                                                                                                           |
| Bootstrap budget    | Configurable max LLM calls per run (2,000 per run) and optionally per day; a run stops in a resumable state when the budget is reached and reports how many messages were skipped.                                                                                                                     |
| Uncertain queue     | Messages over budget or uncertain are surfaced in the review UI instead of being silently dropped.                                                                                                                                                                                                     |
