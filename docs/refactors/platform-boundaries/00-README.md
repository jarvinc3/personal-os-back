# Platform Boundaries — Core Events and Module Settings

This is a cross-cutting cleanup, not a rewrite of Core or Users.

## A. Core Events

### Current issue

Core currently owns `AppEvents`, which contains User, Finance, Notification and module/config event names. Core also contains Finance-specific event DTO classes such as transaction, budget, email sync and transfer events.

At the same time, Finance already has its own `events/` package area with a publisher port and outbox repository/dispatcher. This is evidence that semantic event ownership and transport infrastructure are partially split in two places.

### Target

**Core/shared platform owns:**

- event envelope primitives;
- outbox storage/relay abstractions;
- idempotency guard;
- queue/event transport infrastructure;
- generic observability/retry concerns.

**Domains own:**

- event names/types;
- event payload contracts;
- when events are emitted;
- semantic versioning of those contracts.

Example:

```text
Finance
  FinanceEvents.TRANSACTION_CONFIRMED
  FinanceTransactionConfirmedEvent
          |
          v
Platform event publisher/outbox
          |
          v
Consumers
```

Core should not need a code change when a new Finance event is introduced.

### Outbox observation

The current `FinanceOutboxDispatcher` directly queries the shared `domainEventOutbox` table and dispatches all rows through `EventEmitter2`. Its implementation is generic despite its Finance name/location. This should become platform infrastructure rather than being duplicated for future domains.

### Phases

#### PLATFORM-EVENTS-0 — Contracts ownership

Create domain-owned event contract locations and migrate constants/DTOs without changing transport behavior.

**Gate:** Core event constants contain no Finance semantic catalog.

#### PLATFORM-EVENTS-1 — Generic outbox relay

Promote the generic parts of Finance outbox dispatcher/repository into shared event infrastructure. Domains publish through a shared port/envelope.

**Gate:** a non-Finance domain can publish reliably without copying Finance infrastructure.

---

## B. Users and Module Settings

### Current issue

`UsersService` and Users domain defaults currently know substantial module business configuration:

- Finance email-sync schedule and enablement;
- Finance subscription reminder validation;
- Finance card-due reminder validation;
- Finance weekly-summary recipient rules;
- Finance notification keys;
- detailed defaults for Finance, Agenda, Projects and Health.

This makes Users a semantic owner of every Personal OS module and guarantees that adding module settings requires editing Users.

### Target split

**Users owns:**

- user identity/profile;
- timezone/locale/avatar;
- global user preferences;
- account deletion orchestration;
- persistence/association of which modules a user has enabled, if this remains the chosen storage boundary.

**Each module owns:**

- its settings schema;
- defaults;
- validation;
- migrations/versioning of its config payload;
- notification preference keys;
- domain-specific recipient/query semantics.

**Platform module-settings layer owns:**

- registry/discovery of module settings descriptors;
- generic merge/validate/update flow;
- module enable/disable state;
- a generic read API used by guards/Notifications/AI;
- persistence adapter to `UserModule` if retained.

Conceptual contract:

```ts
interface ModuleSettingsProvider<TConfig> {
  slug: string;
  version: number;
  defaults: TConfig;
  validate(input: unknown): TConfig;
}
```

Exact API is deferred to implementation design.

### Why a registry is preferable to moving all defaults into another central file

Moving `DEFAULT_MODULE_CONFIG_BY_SLUG` from Users to Core would preserve the same coupling under a different name. Modules should register their descriptors; the platform layer should not encode their fields.

### Interaction with AI roles/consent

The AI roadmap proposes roles and `contributeToGlobalKnowledge`. Roles are authorization/account concerns and can live in Users/Auth-facing platform services as already planned. AI contribution consent is an AI/privacy preference; its semantic schema should be AI-owned even if persisted through generic user/module settings infrastructure.

### Phases

#### PLATFORM-SETTINGS-0 — Module settings contract/registry

Define provider descriptor + registry + generic read/validate/update interface. Register existing modules without changing persisted data shape.

**Gate:** adding a dummy module with settings requires no edit to Users defaults/switch statements.

#### PLATFORM-SETTINGS-1 — Move module semantics

Move Finance/Agenda/Projects/Health defaults and validators to owning modules. Move Finance notification keys with Finance. Remove Finance-specific methods from `UsersService`.

**Gate:** Users contains no Finance-specific config parsing/validation/query methods.

#### PLATFORM-SETTINGS-2 — Consumer migration

Migrate Notifications policy, module-enabled guard and schedulers/recipients to generic settings contracts or domain-owned queries as appropriate.

**Gate:** Notifications does not import module-specific defaults from Users.

## Explicitly preserved

- Supabase Auth boundary;
- Users account deletion/outbox behavior unless AI data deletion requires extension;
- user profile API;
- existing `UserModule` persistence can remain if it works with the registry;
- Core guards/queues/observability unrelated to semantic ownership.
