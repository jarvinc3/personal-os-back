# Vision and Goals

## Product vision

Personal OS is intended to centralize and automate multiple areas of everyday life inside a single personal application.

The AI layer should eventually be capable of:

- understanding information arriving from external integrations;
- correlating information across modules;
- learning reusable patterns;
- maintaining user-specific context;
- surfacing useful suggestions;
- answering questions using module state;
- invoking module capabilities;
- safely executing permitted actions;
- becoming proactive where appropriate.

The architecture must therefore support much more than interactive chat.

## Primary redesign objective

Replace the current chat-centric and Finance-centric AI composition with a general Personal OS intelligence architecture.

The target system should have five durable primitives:

### Knowledge

What Personal OS has learned and can reuse.

Examples:

- a sender belongs to an organization;
- a stable email template represents a purchase notification;
- a template routes to Finance and Subscriptions;
- a user-specific masked card maps to a concrete Finance card.

### Signals

Structured representations of things that happened or may matter now.

Examples:

```text
FINANCE.TRANSACTION_DETECTED
SUBSCRIPTIONS.PRICE_CHANGE
CALENDAR.EVENT_DETECTED
TRAVEL.BOOKING_CONFIRMED
SECURITY.ACCOUNT_ALERT
```

### Capabilities

What each Personal OS module allows the agent to read or do.

The AI runtime should discover capabilities instead of hard-coding every domain tool centrally.

### Action Policy

The safety/authorization boundary that determines whether an action is:

```text
AUTO_ALLOWED
CONFIRM_REQUIRED
FORBIDDEN
```

### Inference Gateway

An interchangeable abstraction over LLM providers/models.

LLMs interpret unknown or ambiguous information. They do not own durable knowledge.

## First major use case

Email Intelligence V1 is the first Source Intelligence Engine.

Finance is the first serious consumer and benchmark.

The initial objective is to analyze the user's Gmail history from 2026-01-01 onward repeatedly and build reliable knowledge from BHD, Banco Popular and Qik emails.

This is not intended to remain Finance-only.

## Primary quality objective for Finance email detection

Prioritize transaction recall.

Missing a real transaction is worse than allowing some extra candidates to reach later stages.

The system should become cheaper and more deterministic as knowledge improves:

```text
unknown email
   -> deterministic relevance signals
   -> known template?
      -> yes: deterministic parser
      -> no: LLM fallback
   -> structured result
   -> evidence
   -> knowledge
```

## Long-term source model

Email is only the first source.

The same intelligence architecture should eventually support sources such as:

```text
Gmail
Calendar
Bank APIs
Health integrations
GitHub
documents/receipts
notifications
other connected applications
internal Personal OS domain events
```

All should be able to produce observations/signals without forcing each domain to implement its own AI subsystem.
