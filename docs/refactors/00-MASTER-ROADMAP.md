# Personal OS — Master Architecture Refactor Roadmap

## Purpose

Coordinate independent but related architecture programs without turning the AI roadmap into the roadmap for all of Personal OS.

Detailed programs:

- AI Intelligence + Email: `personal-os-ai-redesign-context-pack/07-ROADMAP-AND-TESTABLE-PHASES.md` (existing source of truth until folder rename).
- Finance boundaries: `finance-boundaries/00-README.md`.
- Notifications: `notifications/00-README.md`.
- Core Events + Module Settings: `platform-boundaries/00-README.md`.
- Cross-cutting audit/invariants: `00-ARCHITECTURE-AUDIT.md`.

## Principle

Each program has its own testable phases. This master roadmap defines ordering and integration gates, not duplicate implementation detail.

## Dependency map

```text
FOUNDATION / CLEAN BASELINE
        |
        +------------------------------+
        |                              |
        v                              v
AI-0 controlled reset          PLATFORM-EVENTS-0 contracts
        |                       PLATFORM-SETTINGS-0 registry
        |                              |
        +-----------+------------------+
                    |
          +---------+---------+
          |                   |
          v                   v
 AI-1 Inference Gateway    FIN-0 boundary contracts
          |                   |
          v                   v
 AI-2 Gmail/corpus         FIN-1 remove Gmail ownership
          |
 AI-3 evidence/review
          |
 AI-4 knowledge
          |
 AI-5 email intelligence
          |
 AI-6 evaluation
          |
          v
 AI-7 Signals -----------------------> FIN-3 Signal Consumer
          |                                  |
          |                                  v
          |                           Finance domain state/events
          |
          +-----> AI-8 Capabilities <------ FIN-2 AI adapters
          |                |
          |                v
          |          AI-9 Agent Runtime
          |                |
          |          AI-10 Action Policy
          |
          +------------------------------+
                                         |
                              NOTIF-0/1 generic intents
                                         |
                              FIN-4 Finance intent producer
                                         |
                              NOTIF-2 Finance migration
                                         |
                              NOTIF-3 settings decoupling
```

The diagram shows dependencies, not a strict one-task-at-a-time schedule. Independent phases may proceed in parallel after their prerequisites are stable.

## Recommended execution waves

### Wave A — Architecture baseline

- AI-0 controlled reset;
- FIN-0 boundary contracts;
- PLATFORM-EVENTS-0 semantic ownership;
- PLATFORM-SETTINGS-0 module settings contract/registry;
- NOTIF-0 NotificationIntent contract.

**Integrated gate:** dependency rules are explicit before new infrastructure is built. No new legacy coupling is introduced during the reset.

### Wave B — Infrastructure ownership

- AI-1 Inference Gateway;
- AI-2 Gmail/corpus;
- FIN-1 removal of Finance Gmail ownership (incluye borrar en el mismo paso los eventos de importación por email: `FINANCE_TRANSACTION_IMPORTED`, `FinanceEmailSyncCompletedEvent` y sus listeners/copy/constantes; no quedan huérfanos hasta NOTIF-2);
- PLATFORM-EVENTS-1 generic outbox relay;
- PLATFORM-SETTINGS-1 move module config semantics;
- NOTIF-1 generic intent delivery pipeline.

**Integrated gate:** AI owns external email source, Finance is source-agnostic, domains own event/settings semantics, Notifications can deliver a generic intent.

### Wave C — Intelligence loop

- AI-3 Dataset/Runs/Evidence/Human Verification;
- AI-4 Knowledge Engine;
- AI-5 Email Intelligence;
- AI-6 Evaluation.

Other programs should remain stable while this loop is proven.

**Integrated gate:** intelligence can classify/evaluate without mutating Finance.

### Wave D — Cross-domain integration

- AI-7 Signals;
- FIN-3 Finance Signal Consumer;
- FIN-2 Finance AI/context adapters;
- AI-8 Capability Registry.

**Integrated gate:** Email -> Signal -> Finance works without Gmail in Finance, and AI discovers Finance through capability contracts rather than a facade.

### Wave E — Agency and notification cleanup

- AI-9 Agent Runtime V2;
- AI-10 Action Policy;
- FIN-4 Finance notification/event ownership cleanup;
- NOTIF-2 migrate Finance notification semantics;
- PLATFORM-SETTINGS-2 consumer migration;
- NOTIF-3 settings decoupling.

**Integrated gate:** Agent, Finance, Notifications, Core and Users interact through explicit boundaries; no central domain switch remains in AI/Notifications/Core/Users.

### Wave F — Finance IMPORT / release gate

The existing AI roadmap currently places Finance IMPORT at AI Phase 11 and PROD deployment after it. Preserve that release condition: `0.50.0` is not PROD-ready until end-to-end Finance import is restored and all boundary integration tests pass.

Mientras el gate no se cumpla, los hotfixes de PROD siguen la estrategia de `release/0.49.x` descrita en *Estrategia de release y hotfixes*.

## Required cross-program architecture tests

Add static/import tests or equivalent checks for these invariants:

1. AI generic runtime cannot import Finance implementation/facade.
2. Finance cannot import Gmail provider/source infrastructure.
3. Finance cannot import chat-context contracts.
4. Notifications cannot import Finance event payloads/copy/settings constants after migration.
5. Core cannot own Finance event constants/DTOs after migration.
6. Users cannot import Finance config validators/defaults after migration.
7. New module settings can register without modifying Users central defaults.
8. New domain events can be published without modifying Core event constants.

## Phase completion rule

Every local phase still requires:

```text
IMPLEMENTATION
      |
AUTOMATED TESTS
      |
OBSERVABLE DEMO
      |
LOCAL GATE
      |
MASTER INTEGRATION GATE (when applicable)
```

A refactor is not considered complete merely because files moved.

## Estrategia de release y hotfixes durante el reset

Decisión del owner: excepción explícita a la regla \

This master roadmap does not create independent production releases for every documentation phase. The existing `0.50.0` architecture-reset release remains the coordinated backend/web target unless the owner later changes that decision. Hasta su salida a PROD, los parches de producción van por `release/0.49.x` (ver sección anterior).
