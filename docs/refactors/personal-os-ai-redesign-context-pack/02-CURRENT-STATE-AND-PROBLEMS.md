# Current State and Problems

## Current AI package

The existing `packages/ai-agent` already contains useful components:

- provider abstraction;
- Groq/OpenRouter support;
- round-robin provider selection;
- preferred provider;
- retry/failover;
- streaming and non-streaming completions;
- chat sessions/messages;
- tool calling;
- pending confirmation actions;
- session summarization;
- event-driven AI processing;
- Finance tools/context.

These concepts should not all be discarded.

## Current architectural shape

The existing AI implementation is fundamentally centered around an interactive chat agent.

Conceptually:

```text
AiAgentRunner
  + chat orchestration
  + module context
  + tool selection
  + tool execution
  + action confirmation
  + FinanceFacade context
  + entity resolution
  + UI blocks
  + memory summary scheduling
```

The general agent runtime directly knows Finance.

This is the wrong dependency direction for a modular Personal OS.

## Static module/tool ownership

Current module context/tool configuration is centrally defined.

Conceptually:

```text
AI
 |
 +-- knows Finance tools
 +-- knows Agenda tools
 +-- knows Projects tools
 +-- knows Health tools
```

As Personal OS grows, this becomes a large central switch.

Target dependency direction:

```text
Finance --------\
Agenda ----------+--> AiCapabilityRegistry --> Agent
Projects --------/
Health ----------/
```

Each domain owns its AI-facing capabilities.

## Current memory limitation

Current session memory is essentially conversation summarization.

That is useful for chat compression but is not durable Personal OS knowledge.

It lacks the required semantics for:

- provenance;
- evidence;
- contradiction handling;
- verification;
- global/user scope;
- reversible promotion;
- reproducible rebuilding.

Therefore conversation summary and durable knowledge must be separate concepts.

## Current proactive AI limitation

The existing proactive flow is approximately:

```text
Domain Event
  -> hard-coded prompt
  -> LLM
  -> chat insight
```

The target should instead be:

```text
Observation / Event
  -> structured Signal
  -> correlation/relevance/policy
  -> optional reasoning
  -> no-op / module consumption / suggestion / action
```

Not every event should trigger an LLM call or create a chat message.

## Current Finance email architecture

The current email ingestion flow is Finance-owned.

Conceptually:

```text
EmailConnection
  -> FinEmailSource / configured institution + senders
  -> Gmail query filtered by sender/domain
  -> AI extractor
  -> routing
  -> Finance ledger
```

The main flaw is that false negatives can happen before AI sees the message.

If a real transaction arrives from a sender/domain not already configured, the Gmail query can exclude it entirely.

Other important current characteristics worth preserving:

- Gmail OAuth/token integration;
- message retrieval/parsing;
- message ID deduplication;
- content fingerprinting;
- AI extraction schema;
- Zod validation;
- transaction/pending/not-transaction semantics;
- amount/currency/date/type/merchant extraction;
- movement classes;
- bank references/status;
- instrument hints;
- payroll fallback;
- reversal handling;
- transfer matching;
- backfill/retry behavior;
- logs;
- provider/model tracking.

## Core redesign conclusion

Do not migrate the old Finance email model forward merely for compatibility.

Email must become AI-owned source infrastructure.

Finance should consume Finance signals after email interpretation rather than own Gmail ingestion.
