# Target Architecture

## High-level model

```text
                         PERSONAL OS
                              |
                    AI INTELLIGENCE LAYER
                              |
       +----------------------+----------------------+
       |                      |                      |
    Sources               Intelligence           Agent
       |                      |                      |
 Email/Calendar/...     Evidence/Knowledge     Reason/Plan
 Internal Events            Signals             Converse
       |                   Inference               |
       +----------------------+----------------------+
                              |
                        Action Policy
                              |
                     Capability Registry
                              |
             +----------------+----------------+
             |                |                |
          Finance           Agenda          Projects
```

## Inference

Current provider abstraction should survive conceptually but be renamed/scoped appropriately.

Suggested target:

```text
AiInferenceGateway
  |
  +-- provider adapters
  +-- retry/failover
  +-- task-aware routing later
  +-- structured output
  +-- telemetry
```

The gateway does not own knowledge.

## Agent Runtime

Target decomposition:

```text
AiAgentOrchestrator
  +-- AiContextAssembler
  +-- AiCapabilityRegistry
  +-- AiToolLoop
  +-- AiActionPolicy
  +-- AiConversationStore
  +-- AiInferenceGateway
  +-- AiResponsePresenter
```

The orchestrator must not directly import `FinanceFacade`.

## Capability Registry

Each domain exposes its own AI contract.

Conceptual provider:

```ts
interface AiModuleCapabilityProvider {
  moduleSlug: string;

  describe(): AiModuleDescriptor;

  getTools(): AiToolDefinition[];

  executeTool(
    ctx: AiToolContext,
    toolName: string,
    args: unknown,
  ): Promise<AiToolExecutionResult>;

  resolveEntityContext?(
    request: AiEntityContextRequest,
  ): Promise<AiEntityContext | null>;

  getAgentContext?(
    userId: string,
  ): Promise<AiModuleContext>;
}
```

Possible domain integrations:

```text
FinanceAiCapabilities
AgendaAiCapabilities
ProjectsAiCapabilities
HealthAiCapabilities
```

## Signals

Signals decouple intelligence from domain mutations.

Example:

```text
Email Intelligence
      |
      v
AiSignal(FINANCE.TRANSACTION_DETECTED)
      |
------ domain boundary ------
      |
FinanceSignalConsumer
      |
Finance domain logic
```

Email Intelligence must not directly call Finance transaction creation.

## Knowledge vs Signals

```text
Knowledge
  = reusable understanding

Signal
  = something happened / matters now
```

Example Knowledge:

```text
sender X belongs to Banco Popular
template Y means PURCHASE_NOTIFICATION
```

Example Signal:

```text
a purchase of RD$2,500 was detected
```

## Suggested package topology

Initially the current package can be reorganized rather than split physically:

```text
packages/ai-agent/src/
  inference/
  agent/
  conversation/
  capabilities/
  actions/
  intelligence/
    signals/
    knowledge/
    review/
    experiments/
  sources/
    email/
  proactive/
```

A later rename to `packages/ai` or split between `ai` and `ai-agent` is possible, but not required to establish correct boundaries.

## Architectural dependency rules

1. AI source infrastructure must not depend on Finance.
2. Agent core must not import domain facades directly.
3. Domain modules register capabilities/consumers/context providers.
4. Knowledge projections depend on evidence, never the reverse.
5. Evaluation/HOLDOUT cannot mutate the knowledge being evaluated.
6. LLM provider/model choice is infrastructure metadata, not durable truth.
7. Domain writes happen only through domain-owned consumers/capabilities.
