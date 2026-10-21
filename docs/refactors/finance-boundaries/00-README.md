# Finance Architecture Boundary Refactor

## Scope

This is **not Finance V2** and does not rebuild healthy Finance domain logic. It removes responsibilities that leaked into Finance because email and the old agent architecture were Finance-centric.

## Current strengths to preserve

Finance is already decomposed into focused submodules: analytics, balance sheet, catalog, FX, integrity, ledger, merchants, planning, quick entry, receivables, reconciliation, recurring, statements, subscriptions and others. Preserve their business behavior unless a separate bug requires change.

The Finance events package also already contains an application port plus outbox infrastructure. The underlying reliable-delivery/idempotency concepts should survive even if ownership of generic dispatch infrastructure moves.

## Problems to correct

### 1. Email ingestion owns too much

`packages/finance/src/ingestion/**` currently contains both source intelligence and legitimate Finance application behavior.

**Move to AI Intelligence:**

- Gmail OAuth/source connection;
- provider sync/cursor/bootstrap;
- raw/sanitized/canonical email persistence;
- sender/domain/template detection;
- email relevance/classification;
- LLM email extraction infrastructure;
- general email review/evidence.

**Keep/rehome inside Finance:**

- financial transaction normalization after a Finance signal;
- institution/instrument resolution;
- financial-event deduplication;
- pending/final/reversal behavior;
- transfer matching;
- ledger import;
- reconciliation/backfill behavior that is truly financial.

The new entry boundary is `FinanceSignalConsumer`, not Gmail.

### 2. `FinanceFacade` is too broad as a cross-module/AI contract

The facade delegates rather than implementing all business logic, so it is not an internal god service. The issue is its role as a universal public API, especially for AI.

Target direction:

- normal HTTP controllers may continue using application services inside Finance;
- AI uses `FinanceAiCapabilities` / `FinanceAiContextProvider` registered through generic AI contracts;
- signal ingestion uses `FinanceSignalConsumer`;
- other modules depend on narrow explicit contracts only when necessary;
- no generic AI layer imports `FinanceFacade`.

Whether `FinanceFacade` remains as an internal convenience facade can be decided during implementation; it must stop being the architectural boundary for every consumer.

### 3. Chat context is not a Finance concept

Any Finance service whose API is expressed in terms of `ChatContextEntity` should become a Finance-owned entity/context resolver behind an AI capability/context adapter. Finance can resolve its own entities; it should not know that the caller is a chat.

### 4. Notification semantics belong with Finance, delivery does not

Finance should own the decision that a financial occurrence has a user-facing semantic message and construct a `NotificationIntent` through a Finance adapter/factory. Notifications owns policy, persistence and channel delivery.

### 5. Finance event semantics belong to Finance

Finance event names/contracts currently centralized in Core should move to Finance-owned contracts. Shared event transport/outbox infrastructure remains platform infrastructure.

## Target integration surface

```text
AI Email Intelligence
        |
        v
     AiSignal
        |
        v
FinanceSignalConsumer
        |
        v
 Finance application/domain
        |
   +----+-------------------+
   |                        |
Finance domain events   FinanceNotificationAdapter
   |                        |
shared transport       NotificationIntent
                            |
                            v
                      Notifications
```

AI conversation path:

```text
Agent Runtime
    |
AiCapabilityRegistry
    |
FinanceAiCapabilities
    |
Finance application services
```

## Testable phases

### FIN-0 — Boundary contracts

Define Finance-owned event contracts, Finance AI adapter contracts, `FinanceSignalConsumer` boundary and Finance notification-intent adapter shape. No business behavior changes.

**Gate:** architecture tests/import rules can express the intended dependency direction.

### FIN-1 — Remove legacy source ownership

Coordinated with AI Phase 0/2: delete Finance-owned Gmail/source infrastructure and email-specific public endpoints/settings dependencies. Preserve identified financial algorithms as reusable application/domain code or tests.

En el mismo paso se eliminan los eventos de importación por email y todo lo que dependa de ellos: `FINANCE_TRANSACTION_IMPORTED`, `FinanceEmailSyncCompletedEvent` (Core `domain-events.ts` / `event.constants.ts`), sus handlers en `NotificationsEventsListener`, el copy asociado en `notification-copy.ts` y las constantes/claves de notificación exclusivas de la importación. No se dejan huérfanos hasta NOTIF-2.

**Gate:** Finance builds without Gmail/OAuth/source models, y no queda ningún emisor, listener, copy ni constante de eventos de importación por email.

### FIN-2 — Public integration cleanup

Move AI/chat consumers off `FinanceFacade`; replace chat-context types with Finance entity/context adapters; narrow external contracts.

**Gate:** AI package has zero imports of Finance implementation/facade and Finance has zero imports of chat concepts.

### FIN-3 — Signal import

Coordinated with AI Signals/IMPORT phases. Implement idempotent `FinanceSignalConsumer` using preserved financial behavior.

**Gate:** a routed Finance signal can create/update the correct financial state without Finance reading an email.

### FIN-4 — Notification/event ownership cleanup

Finance publishes Finance-owned event contracts and creates domain-owned notification intents. Remove Finance semantic interpretation from Notifications.

**Gate:** adding a new Finance notification does not require editing a central Notifications Finance-event switch.

## Explicit non-goals

- rewriting Ledger;
- redesigning budgets/planning;
- rewriting catalog/accounts/cards;
- changing reconciliation semantics without evidence;
- fixing unrelated balance/ledger bugs as part of this refactor.
