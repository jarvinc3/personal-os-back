# AI-1 — Inference Gateway design

Status: merged into `develop` through [PR #196](https://github.com/jarvinc3/personal-os-back/pull/196)
at `5f9125c`. CI and Railway DEV deployment `7296557646` succeeded on
2026-10-24. Production was not modified. The GitHub deployment record exposed
only the Railway dashboard URL, so no remote API health check is recorded.
Phase issue: [#204](https://github.com/jarvinc3/personal-os-back/issues/204).

Source of scope: [roadmap Phase 1 archivado](../../../../archive/intelligence/07-roadmap-and-testable-phases-v1.md#phase-1--inference-gateway).

## Owner decisions

- Persist inference metadata and an input fingerprint; never persist prompts or
  model results in telemetry.
- Keep the diagnostic harness as a local CLI command; do not expose a diagnostic
  API route.
- Expire per-user telemetry after 90 days and cascade it when the user is
  deleted.
- The diagnostic harness is a local CLI with synthetic input and no telemetry
  context by default.

## Boundary and callers

`packages/intelligence` owns `AiInferenceGateway`, provider adapters, retry/failover,
structured-output parsing and telemetry. Finance continues to depend only on
the neutral contracts package. Phase 1 migrates Quick Entry and statement
extraction from free-form JSON parsing to the structured gateway; their existing
domain-level validation and fallback behavior remain in Finance.

The gateway records task, user/source context, selected provider/model, elapsed
time, fallback count, token counts when providers return them, prompt/schema
versions, status, a safe error code and an input fingerprint. The return value
and prompt are available to the caller only and are not written to `AiInference`
or logs.

## Persistence proposal

Add an `AiInference` Prisma model with:

- UUID `id` and required `userId` FK to `User`, `onDelete: Cascade`;
- `task`, optional `sourceType`/`sourceId`, `provider`, `model`;
- `promptVersion`, `schemaVersion`, keyed `inputFingerprint` and
  `fingerprintVersion`;
- `status`, `errorCode`, `fallbackCount`, `latencyMs`;
- optional input/output token counts when returned by a provider;
- `createdAt` and `expiresAt` (90 days after creation).

Do not include `resultJson`, prompt text, raw provider error text or token
sequences. `sourceType`/`sourceId` are opaque correlation fields without FKs so
the telemetry model does not own Finance or future AI run records. Index by
`(userId, createdAt)` and `expiresAt`. A scheduled retention job deletes expired
rows. Account deletion cascades through the user FK; self-service data wipe
exposes an `ai.inferences` branch.

For `inputFingerprint`, use HMAC-SHA256 rather than a plain hash because the
inputs can contain low-entropy financial values. Derive a separate key with
`DATA_ENCRYPTION_KEY` and the purpose/version label
`personal-os:ai-inference:fingerprint:v1`. Rotating the encryption key rotates
the fingerprint; the source messages are never retained for rehashing.

## Gateway contract

The neutral contract accepts a task, messages, optional preferred provider,
provider-neutral JSON Schema, caller-supplied validation, prompt/schema versions,
and optional user/source context. It returns a validated typed value plus
provider/model, latency, fallback count and available token usage. The contract
does not import Nest, Prisma, Zod, Finance or SDK types. Finance may derive the
provider JSON Schema from its Zod schema, then keep its own domain validation.

The gateway applies the existing round-robin ordering and preferred-provider
promotion. Retryable provider failures move to the next provider. A returned
payload that fails JSON parsing or schema validation also moves to the next
provider; the final failure is classified without persisting raw response text.
Provider attempts are bounded to one attempt per configured provider per
request. Non-retryable transport/auth errors fail immediately.

## Telemetry failure behavior

Inference success must not be turned into a failed Quick Entry or statement
operation solely because the telemetry insert failed. The gateway returns the
validated result and logs a sanitized telemetry-write warning. Errors stored
in `AiInference` are normalized codes, not exception messages that may contain
prompt fragments.

## Verification and demo

- Unit: provider success; retryable failure/fallback; preferred provider;
  round-robin; JSON parsing and schema rejection; no raw prompt/result in the
  telemetry record; telemetry-write failure does not discard a valid result.
- Integration: Prisma persistence, user cascade, explicit `ai.inferences` wipe,
  and expiration at 90 days.
- E2E: Quick Entry parsing and statement import still work with structured
  output; retired chat/Gmail surfaces remain absent.
- Demo: a local CLI command runs against a synthetic prompt and prints task,
  selected provider/model, validated result, elapsed time and fallback/error
  summary. It makes no API endpoint and writes no telemetry unless explicitly
  given a user/source context.

## Implementation decisions

- Statuses are `SUCCEEDED` and `FAILED`; errors are normalized as
  `NO_PROVIDER`, `PROVIDER_FAILURE`, `INVALID_JSON` or `SCHEMA_VALIDATION`.
- JSON Schema is included in the provider-neutral system instructions, then
  parsing and caller validation run locally. Each configured provider is tried
  once; malformed JSON and validation failures allow fallback. A final invalid
  output is distinct from a retryable provider failure for statement imports.
- Token counts are stored only when returned by provider SDKs. Cost is omitted
  because it depends on changing model prices and is not required for the gate.
