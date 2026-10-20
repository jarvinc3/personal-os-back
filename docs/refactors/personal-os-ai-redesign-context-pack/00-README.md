# Personal OS — AI Intelligence Redesign Context Pack

## Changelog

### 2026-10-20 (d) — Multi-user decisions + roles layer

| Decision                                                                                                                                                                                                                                                                 | Effect                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Consent is **ON by default (opt-out)**: settings toggle + explanatory screen at Gmail connect, revocable anytime.                                                                                                                                                        | Risk/TODO: the beta privacy notice must clearly disclose default-on contribution (`10`). |
| Templates/senders with evidence from >= 2 distinct consenting users **auto-promote** to GLOBAL; visible to admins and reversible.                                                                                                                                        | `05`, `07`.                                                                              |
| Each user can **export and delete** everything about them (corpus, messages, USER knowledge, mappings, verifications). GLOBAL knowledge stays; on deletion the user's evidence is anonymized/detached (tombstoned) so GLOBAL remains reproducible without personal data. | `05`, `09`, `12`.                                                                        |
| New **roles layer**: app-owned Prisma table + NestJS `RolesGuard` on top of the existing Supabase Auth JWT guard (not Postgres roles/RLS). V1 roles `USER \| CONTRIBUTOR \| ADMIN`; fine-grained permissions V2. Built in Phase 2.                                       | `03`, `05`, `07`, `08`, `09`, `12`.                                                      |

All `[DECISION: Jarvin]` items are now resolved.

### 2026-10-20 (c) — Owner resolved pending decisions

| Decision                                                                                                                                                           | Effect                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Current chat deleted in Phase 0 (runner, tool executor/registry, prompts, chat endpoints, proactive listener) together with email legacy; web chat hidden/removed. | No chat until Phase 9; chat UX pending owner redesign input. Provider adapters, failover, streaming, Zod and `AiAction` concepts are preserved. |
| Signals: own `AiSignal` table + existing `DomainEventOutbox`/BullMQ.                                                                                               | Accepted (`12`).                                                                                                                                |
| `0.50.0` PROD deploy after Phase 11 (Finance import).                                                                                                              | Accepted.                                                                                                                                       |
| Raw retention 30 days DEV / 7 days PROD.                                                                                                                           | Accepted.                                                                                                                                       |
| No field-level encryption in V1.                                                                                                                                   | Accepted.                                                                                                                                       |
| All configured LLM providers allowed; only RELEVANT/UNCERTAIN mail by default + recall audit sample (2%) of discarded mail for admin/consenting users.             | `03`, `06`, `08`.                                                                                                                               |
| Bootstrap cap 2,000 LLM calls per run, resumable.                                                                                                                  | Accepted.                                                                                                                                       |

Still open: consent UX, admin review for GLOBAL promotion, multi-user retention (`10`).

### 2026-10-20 (b) — Multi-user beta + simplified V1

| Change                                                                                                                                                                                                                                                                                                                          | Why                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Multi-user essentials kept in V1: append-only evidence + projector, GLOBAL/USER scope with strict privacy (GLOBAL = structural only), promotion to GLOBAL needs >= 2 distinct consenting users OR admin verification, anti-feedback, per-user isolation, opt-in consent flag, frozen HOLDOUT, deterministic-first (`05`, `09`). | The beta opens to several users who contribute email data for training. |
| Deferred to V2: logical knowledge snapshots (V1 = sequence watermark + projector/policy version on each run), multi-model consensus (V1 = single model + deterministic validation + human review), month-by-month replay, dataset versioning (V1 = one dataset with partition field) (`05`, `07`, `09`).                        | Move faster.                                                            |
| Single `AiKnowledge` table with `scope` replaces the separate knowledge table families (`09`).                                                                                                                                                                                                                                  | Simpler schema.                                                         |
| Roadmap compressed from 16 to 13 phases (0–12); labeling UI by Phase 3; old->new mapping table in `07`.                                                                                                                                                                                                                         | Merged/deferred phases.                                                 |
| New open questions: consent UX, admin review for GLOBAL promotion, multi-user retention (`10`).                                                                                                                                                                                                                                 | Needed before opening the beta.                                         |

### 2026-10-20 (a) — Owner decisions incorporated

### 2026-10-20 — Owner decisions incorporated

| Change                                                                                                                                   | Why                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 (legacy deletion + migration reset) confirmed; PROD isolation documented (`03`, `07`, `11`).                                     | PROD has its own DB/environment and stays on the current version until the owner decides the `0.50.0` deploy. Migrations run only against DEV. |
| Open balance/ledger/planning bugs declared out of scope and non-blocking (`03`, `10`).                                                   | They are fixed in parallel on `develop`; the refactor must not wait for them nor block them.                                                   |
| Full-mailbox Gmail download from 2026-01-01 approved; default privacy/cost policy proposed (`03`, `06`, `10`).                           | Needed to measure false negatives; defaults keep non-financial mail away from LLMs and bound cost/retention.                                   |
| Review/labeling UI moved earlier: minimal UI by Phase 2–4, growing every phase; old Phase 9 becomes "Review UI completion" (`07`, `08`). | The owner must verify results of every phase, and evaluation (Phase 8) needs human labels that already exist.                                  |
| Quick-entry and statement extractors migrate to the Inference Gateway in Phase 1 (`07`).                                                 | They also call LLMs and were not covered.                                                                                                      |
| New `12-REPO-IMPACT.md`: affected web screens/endpoints at Phase 0, Signals vs outbox/BullMQ proposal, ADR and repo-instruction changes. | Fill gaps required before implementation.                                                                                                      |
| Items still needing owner decision are tagged **[DECISION: Jarvin]**.                                                                    | Make pending decisions searchable.                                                                                                             |

## Purpose

This package is the handoff/context bundle for the redesign of the Personal OS AI architecture and Email Intelligence Engine.

It is intended to let another engineering agent understand:

- what Personal OS is trying to become;
- what exists today;
- why the current AI/email architecture is being replaced;
- which decisions have already been made;
- the target architecture;
- the knowledge/evidence/snapshot model;
- how Email Intelligence fits into the larger AI system;
- the implementation roadmap;
- what must be demonstrated and tested at the end of every phase;
- what remains undecided.

## Project context

Personal OS is a personal, multi-module application composed of mini-apps for areas such as:

- finance;
- agenda/calendar;
- projects;
- health;
- subscriptions;
- habits;
- goals;
- notes;
- future integrations.

Finance is currently the most actively developed module, but the long-term objective is not to build an AI assistant for Finance. The objective is to build an AI/intelligence layer integrated throughout Personal OS.

Email is therefore considered a general information source for Personal OS, not a Finance-specific integration.

## Current project conditions

- Closed beta.
- Closed beta, opening soon to several users who contribute email data (contribution on by default, opt-out).
- DEV and PROD have separate databases and environments. PROD is unaffected by the redesign until a deliberate `0.50.0` deploy decided by the owner; migrations run only against DEV.
- Existing production data is not relevant and may be deleted.
- The migration history may be reset after verifying PROD `_prisma_migrations`.
- The redesign intentionally removes legacy code rather than preserving backward compatibility.
- Backend and frontend target version: `0.50.0`.
- Initial historical email corpus: Gmail from 2026-01-01 to the current date.
- BHD, Banco Popular and Qik are the initial Finance benchmark institutions.
- Historical analysis will be executed repeatedly.
- Open balance/ledger/planning bugs are out of scope and fixed in parallel (see `03`).

## Recommended reading order

1. `01-VISION-AND-GOALS.md`
2. `02-CURRENT-STATE-AND-PROBLEMS.md`
3. `03-DECISIONS-AND-INVARIANTS.md`
4. `04-TARGET-ARCHITECTURE.md`
5. `05-KNOWLEDGE-EVIDENCE-AND-EVALUATION.md`
6. `06-EMAIL-INTELLIGENCE-V1.md`
7. `07-ROADMAP-AND-TESTABLE-PHASES.md`
8. `08-TESTING-OBSERVABILITY-AND-GATES.md`
9. `09-DATA-MODEL-DIRECTION.md`
10. `10-OPEN-QUESTIONS-AND-NON-GOALS.md`
11. `11-AGENT-HANDOFF-CHECKLIST.md`
12. `12-REPO-IMPACT.md`

## Core architectural statement

Personal OS should not model AI as a chatbot attached to several mini-apps.

It should model AI as a cross-cutting **intelligence + agency layer**.

```text
External Sources + Internal Domain Events
                  |
                  v
             Observations
                  |
                  v
       AI Intelligence Layer
       /        |          \
 Knowledge   Signals     Inference
       \        |          /
        \       v         /
          Agent Runtime
              |
        Action Policy
              |
     Module Capabilities
              |
  +-----------+-----------+
  |           |           |
Finance     Agenda     Projects ...
```

The chatbot is one interface into this system.

Email is one source.

Finance is one domain consumer.

## Fundamental implementation rule

Every roadmap phase must finish with:

```text
IMPLEMENTATION
      |
      v
UNIT / INTEGRATION TESTS
      |
      v
OBSERVABLE DEMO
      |
      v
ACCEPTANCE GATE
```

A phase is not complete merely because code exists.
