# Testing, Observability and Acceptance Gates

## Testing philosophy

The redesign must remain inspectable throughout implementation.

Do not build several invisible infrastructure phases and only test the final agent.

Each phase needs:

```text
unit tests
integration tests
observable demo
acceptance gate
```

E2E tests should be added when multiple completed phases interact.

## Required test layers

### Unit

Examples:

- template normalizer;
- candidate/relevance detector;
- knowledge promotion policy;
- signal dedup key;
- parser;
- action policy;
- dataset partition logic.

### Integration

Examples:

- Gmail provider -> persisted corpus;
- evidence -> projector;
- snapshot -> reconstructed knowledge;
- email -> inference observation;
- signal -> Finance consumer;
- capability registry -> executor.

### E2E

Examples:

```text
Gmail fixture
 -> canonical email
 -> Email Intelligence
 -> Signal
 -> Finance
 -> Transaction
```

and:

```text
User chat
 -> Agent
 -> Capability Registry
 -> Finance query
 -> Agent response
```

## Fixtures

Use existing Finance email fixtures as a seed, but build a broader corpus.

Important negative classes:

```text
OTP
marketing
security
statement
balance
administrative
ordinary non-financial email
```

Positive classes:

```text
purchase
transfer
payroll
ATM withdrawal
fee
refund
reversal
card payment
pending transaction
```

## Versioning

Persist version identifiers where relevant:

```text
pipelineVersion
candidateDetectorVersion
templateNormalizerVersion
projectorVersion
knowledgePolicyVersion
promptVersion
schemaVersion
datasetVersion
```

## Inference observability

`AiInference` should eventually make model usage inspectable separately from chat.

Useful telemetry:

```text
task
provider
model
latency
status
error
token usage
estimated cost
prompt/schema versions
source/run
```

## Email observability

Useful counters:

```text
messages discovered
messages persisted
duplicates
canonicalization failures
relevant
irrelevant
deterministic classifications
LLM fallbacks
unknowns
review queue size
```

## Knowledge observability

For a knowledge item, UI/debugging should answer:

```text
What is believed?
Why?
Which observations support it?
Which verifications exist?
Which projector/policy produced it?
When did its state change?
Is it GLOBAL or USER?
```

## Run observability

A run should answer:

```text
which dataset?
which partitions?
which evidence watermark / projector version?
which pipeline/detector/prompt versions?
which models/providers were used?
what metrics resulted?
what changed vs previous run?
```

## Owner-verification gate (all phases from Phase 2)

Each phase gate includes: the owner can verify the phase result in the web Intelligence Review UI. A phase whose result is only visible in logs, DB queries or raw endpoints does not pass.

From Phase 3:

```text
review UI action
 -> AiHumanVerification
 -> next projection/run reflects it
```

must be demonstrable.

## Required gates

Never declare a phase complete because migrations/classes/endpoints exist.

Examples:

### Roles gate (Phase 2)

Must demonstrate: USER cannot call admin endpoints; ADMIN can change a role from the web; the change applies on the next request; roles are enforced in the backend (not only hidden in the UI).

### Privacy gate (Phase 4)

Must demonstrate adversarial fixtures with amounts/last4/names never reaching GLOBAL, single-user evidence not promoting without CONTRIBUTOR/ADMIN verification, user deletion leaving GLOBAL reproducible with no personal data, non-consenting users ignored, and cross-user isolation.

### Knowledge gate

Must demonstrate:

```text
evidence
 -> projection
 -> delete projection
 -> rebuild
 -> equivalent projection
```

### Evaluation gate

Must demonstrate two runs against the same frozen HOLDOUT and evidence watermark/versions with comparable metrics.

### Labeling gate (Phase 3)

Must demonstrate labeling a TRAIN and a HOLDOUT message from the web and showing that only the TRAIN label is eligible for Knowledge.

### Signal gate

Must demonstrate a structured signal without direct domain mutation.

### Capability gate

Must demonstrate adding/discovering a capability without editing Agent core's domain switch.

### Finance import gate

Must demonstrate full traceability:

```text
transaction
 -> signal
 -> classification/inference
 -> email
```

### Privacy/budget gate (Phase 5)

Must demonstrate that messages classified irrelevant with high certainty produced no inference calls outside the recall audit sample (~2%, admin/consenting users only), and that a bootstrap run stops resumably at its LLM budget.

## Regression principle

Once a phase has passed its gate, later phases must preserve its test suite.

The roadmap should accumulate confidence rather than replace previous validation.
