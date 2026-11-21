# Coding guidelines

How to write code in this repo: the principles and stack rules every change must follow.

`AGENTS.md` owns workflow, structure and module boundaries. This file owns how the code itself is written. Every example is TypeScript from this stack: NestJS for the API, Prisma for persistence and Jest for tests.

## Quick reference

### Principles

| Do                                                 | Don't                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| Early return on bad input                          | Pyramid `if/else` nesting                                                        |
| Explicit error, fail now                           | Multiple fallbacks that hide the real failure                                    |
| One responsibility per unit                        | Validate + transform + persist + notify in one place                             |
| Extract when duplication repeats                   | Abstract before a second real use                                                |
| Ship the simplest solution for the current problem | Add layers, hooks, or config "just in case"                                      |
| Build only what's needed today                     | Add fields/params/branches for a future case that hasn't arrived                 |
| Compose small, focused units                       | Build deep inheritance chains for unrelated behavior                             |
| Talk only to immediate collaborators               | Reach through several levels of another object's internal structure              |
| A function either does or returns, not both        | Mix a side effect into what looks like a getter                                  |
| Validate once at the edge                          | Re-validate the same invariant in every layer                                    |
| One validator per input                            | Two validators for the same body/query                                           |
| Let errors surface with context                    | Swallow errors in an empty `catch`, or catch-and-continue as if nothing happened |
| Return new values instead of mutating input        | Mutate parameters and hide the side effect from the caller                       |
| One consistent meaning per null/undefined          | Overload null/undefined to mean several different business states                |
| Inject dependencies so units are easy to test      | Hardcode dependencies that force hitting real infra to test                      |
| Inner layers depend on nothing outward             | Let domain logic import Prisma, Nest or HTTP details directly                    |
| Names that reveal role or domain meaning           | Vague names (`data`, `info`, `temp`, `result`, `obj`)                            |
| Named const / union / contract for domain literals | Magic strings scattered through the codebase                                     |
| Depend on interfaces/ports where variation is real | Couple a use case directly to a concrete implementation                          |
| Comments only for important non-obvious intent     | Narrating comments, noise, or stale TODOs                                        |

### This stack

| Do                                                      | Don't                                              |
| ------------------------------------------------------- | -------------------------------------------------- |
| Type the boundary, then trust it                        | `any` anywhere                                     |
| `unknown` plus a schema or guard at the edge            | Cast an `unknown` to a shape and hope              |
| `as` with a written reason                              | `as` to silence the compiler                       |
| `as const` unions for closed sets                       | A string `enum` for a closed set                   |
| Exhaustive `switch` that ends in `never`                | `default` that swallows a new case                 |
| `readonly` for data you don't own                       | Mutate an array that came from a query             |
| Explicit return type on every exported function         | Let every caller re-derive the contract            |
| An object parameter after three parameters              | Positional booleans that change behavior           |
| `await` or explicit rejection handling on every promise | Fire-and-forget a promise that nobody observes     |
| `Promise.all` for independent work                      | Sequential `await` in a loop for unrelated queries |
| Controller asks; service decides                        | Business rules in the controller                   |
| One `$transaction` for writes that must land together   | Two independent writes that can half-fail          |
| One query with `include` or `in`                        | A query inside a `map` over rows                   |
| A validated DTO at the edge                             | Hand-checking `req.body` in the service            |
| Structured logger fields                                | Concatenated strings with a user's email inside    |
| A generic message to the client, the detail in the log  | A stack trace in the HTTP response                 |
| `Prisma.Decimal` for money                              | `number` for an amount                             |
| An explicit timezone in every date calculation          | `new Date()` with no zone, assuming the server's   |

## Principles

### Guard clauses

Validate and exit early. Prefer flat control flow over deep nesting. Keep the happy path at the end, at the shallowest indent level.

```ts
// Bad — pyramid nesting, happy path buried
private resolvePageSize(query: CursorQueryDto): number {
  if (query.limit) {
    if (query.limit > 0) {
      if (query.limit <= MAX_PAGE_LIMIT) {
        return query.limit;
      } else {
        return MAX_PAGE_LIMIT;
      }
    } else {
      return DEFAULT_PAGE_LIMIT;
    }
  } else {
    return DEFAULT_PAGE_LIMIT;
  }
}

// Good — guard clauses, happy path at the end, shallow indent
private resolvePageSize(query: CursorQueryDto): number {
  if (!query.limit || query.limit <= 0) {
    return DEFAULT_PAGE_LIMIT;
  }
  if (query.limit > MAX_PAGE_LIMIT) {
    return MAX_PAGE_LIMIT;
  }
  return query.limit;
}
```

### Fail fast

Invalid input, impossible state, or a broken dependency should fail immediately with a clear error. Prefer that over chains of fallbacks, silent defaults, or "keep going somehow."

**Relationship to "Validate once":** fail fast applies to type and state invariants that should never happen if upstream contracts hold (a required field is `null`, an enum has an impossible value). It is not license to re-check business rules the boundary already validated — that's re-validation, not fail-fast. If a downstream failure reveals that an upstream contract was violated, fix or harden the boundary; do not add a second check that quietly duplicates it.

```ts
// Bad — a silent fallback hides a broken invariant
const rate = FX_RATES[currency] ?? 1;

// Good — fails immediately with a clear error
const rate = FX_RATES[currency];
if (rate === undefined) {
  throw new Error(`No FX rate for ${currency}`);
}
```

### SRP

A function, class, or module has one reason to change. If it does two jobs, split it.

```ts
// Bad — validates, transforms, persists and notifies in one place
async createAccount(userId: string, dto: CreateAccountDto) {
  if (!dto.name) {
    throw new BadRequestException('name required');
  }
  const account = await this.prisma.finAccount.create({
    data: { userId, name: dto.name.trim(), currency: dto.currency },
  });
  await this.push.send(userId, 'Cuenta creada');
  return account;
}

// Good — each unit has a single reason to change
async createAccount(userId: string, dto: CreateAccountDto) {
  const account = await this.repository.insertAccount(userId, dto);
  await this.notifier.accountCreated(userId, account);
  return account;
}
```

### DRY

Do not copy logic that means the same thing. Extract only when duplication is real — not as premature abstraction.

**Practical rule:** extract when at least 2 of these 3 conditions hold:

- The same logic appears **3 or more times** (twice is tolerated; the third confirms the pattern).
- A future change to the business rule would need to be applied in **all** places at once (if not, it's not real duplication, just coincidence).
- The copied code represents the **same domain concept**, not just similar-looking code.

**Not real duplication (do not extract):**

- Two validations that look alike today but belong to different concepts (validating a user's email vs a vendor's email) — they'll likely diverge later.
- Boilerplate required by the surrounding structure (two Nest handlers with the same shape because the decorator requires it), where the shape is imposed from outside and not a domain decision.

```ts
// Bad — extracted prematurely, one real use
export function normalizeName(value: string): string {
  return value.trim().toUpperCase();
}

// Good — the third occurrence confirms one domain concept
export function normalizeMerchantName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}
```

### KISS

Ship the simplest solution that solves the current problem. No extra layers, hooks, or configurability "just in case."

```ts
// Bad — configurability nobody asked for, added "just in case"
export function formatAmount(
  value: Prisma.Decimal,
  options: {
    currency?: string;
    locale?: string;
    showSymbol?: boolean;
    rounding?: 'nearest' | 'up' | 'down';
  } = {},
): string {
  // ...unneeded branches for a single real call site
}

// Good — solves the current problem, nothing more
export function formatAmount(value: Prisma.Decimal, currency: string): string {
  return `${currency} ${value.toFixed(2)}`;
}
```

### YAGNI (You Aren't Gonna Need It)

Build only what the current requirement needs. Don't add fields, params, branches, or abstractions for a future case that hasn't arrived. This differs from KISS: KISS is about keeping the _chosen_ solution simple; YAGNI is about not building things nobody asked for yet.

```ts
// Bad — speculative support for a case no client uses
export function buildBudgetQuery(
  userId: string,
  filters: { archived?: boolean; recurring?: boolean; multiCurrency?: boolean },
) {
  // ...branches for features that do not exist yet
}

// Good — build for the requirement that actually exists
export function buildBudgetQuery(userId: string, periodStart: Date) {
  return { where: { userId, periodStart }, orderBy: { id: 'asc' as const } };
}
```

### Composition over inheritance

Prefer composing small, focused units over deep inheritance chains. Inheritance couples subclasses to implementation details of the parent and tends to break when requirements diverge.

```ts
// Bad — a base class forces unrelated behavior onto every subclass
abstract class BaseFinanceService {
  abstract execute(): Promise<void>;
  async notify(): Promise<void> {
    /* every subclass inherits a notifier it may not have */
  }
}

// Good — compose only the behavior that applies
export class AllocateToGoalUseCase {
  constructor(
    private readonly repository: PlanningRepository,
    private readonly notifier: GoalNotifier,
  ) {}

  async execute(): Promise<void> {
    /* ... */
  }
}
```

### Law of Demeter (don't talk to strangers)

A unit should only interact with its immediate collaborators, not reach through them to grab something several levels deep. Deep chains couple you to structure that isn't yours to know.

```ts
// Bad — reaches through three levels of internal structure
return account.institution.features.push.enabled;

// Good — ask for what you need, let the owner of the structure compute it
return this.institutions.canPush(account.institutionId);
```

### Command Query Separation (CQS)

A function either **does** something (command, causes a side effect) or **returns** something (query) — not both. Mixing the two makes call sites unpredictable: you can't tell if calling something is safe to do twice.

```ts
// Bad — returns a value AND causes a side effect
async peekBalance(accountId: string): Promise<Prisma.Decimal> {
  await this.recalculateBalance(accountId); // hidden write inside a "peek"
  return this.repository.readBalance(accountId);
}

// Good — the query and the command are separate
async readBalance(accountId: string): Promise<Prisma.Decimal> {
  return this.repository.readBalance(accountId);
}

async recalculateBalance(accountId: string): Promise<void> {
  await this.repository.rebuildBalance(accountId);
}
```

### Explicit error handling

Let errors surface with context instead of swallowing them. An empty or generic `catch` hides the real failure and makes debugging production issues much harder.

```ts
// Bad — swallows the error, the caller has no idea a failure occurred
async loadProfile(userId: string): Promise<Profile | null> {
  try {
    return await this.repository.findProfile(userId);
  } catch {
    return null;
  }
}

// Good — the error surfaces with context, the caller decides
async loadProfile(userId: string): Promise<Profile> {
  try {
    return await this.repository.findProfile(userId);
  } catch (error) {
    throw new Error(`Failed to load profile ${userId}`, { cause: error });
  }
}
```

### Immutability by default

Prefer creating new values over mutating existing ones, especially for data passed as a parameter. Mutation hides side effects and makes state changes hard to trace.

```ts
// Bad — mutates the rows the caller still owns
export function markSelected(rows: Invoice[]): Invoice[] {
  rows.forEach((row) => {
    row.selected = true;
  });
  return rows;
}

// Good — returns a new value, the caller's data stays untouched
export function markSelected(rows: readonly Invoice[]): Invoice[] {
  return rows.map((row) => ({ ...row, selected: true }));
}
```

### Null/undefined handling

Pick one convention and apply it consistently. In this repo: `undefined` means "not set", `null` means "explicitly empty" (Prisma returns `null` for a nullable column). Don't use either as a stand-in for a business state that deserves its own explicit value.

```ts
// Bad — null is overloaded to mean three different things
async getDiscount(userId: string): Promise<number | null> {
  const profile = await this.findProfile(userId);
  if (!profile) {
    return null; // no profile
  }
  if (!profile.plan) {
    return null; // no plan
  }
  if (profile.plan.discount === 0) {
    return null; // legitimately zero
  }
  return profile.plan.discount;
}

// Good — each case is explicit and zero is a real value
async getDiscount(userId: string): Promise<number> {
  const profile = await this.findProfile(userId);
  return profile?.plan?.discount ?? 0;
}
```

### Testability as a design constraint

Code that's easy to test is usually well-designed: side effects are isolated, dependencies are injected rather than hardcoded, and units do one thing. If a function is hard to test, that's often a signal the design needs to change, not a signal to skip the test.

```ts
// Bad — hardcoded clock, the test can only pass today
export function isSubscriptionExpired(subscription: FinSubscription): boolean {
  return subscription.expiresAt < new Date();
}

// Good — the clock is a parameter, the test pins it
export function isSubscriptionExpired(
  subscription: FinSubscription,
  now: Date,
): boolean {
  return subscription.expiresAt < now;
}
```

### Dependency direction

Inner layers (domain/business logic) must not depend on outer layers (Nest, Prisma, HTTP). Outer layers depend inward, never the reverse. This keeps business rules testable and portable.

```ts
// Bad — domain logic reaches straight into Prisma
export class LoanSchedule {
  async total(loanId: string) {
    const rows = await this.prisma.finLoanInstallment.findMany({
      where: { loanId },
    });
    return rows.reduce((sum, row) => sum + Number(row.amount), 0);
  }
}

// Good — the rule takes data, the repository owns the query
export function totalInstallments(
  rows: readonly LoanInstallment[],
): Prisma.Decimal {
  return sumMoney(rows.map((row) => row.amount));
}
```

### Clear names

Variables, parameters, functions, and types must say what they hold or do. Prefer domain words over vague fillers (`data`, `info`, `item`, `temp`, `result`, `obj`, `val`, `x`). If the honest name is long, that is fine — a short vague name is not.

```ts
// Bad — vague names that hide the domain meaning
async process(data: unknown) {
  const temp = await this.find(data);
  return temp;
}

// Good — names reveal role and domain meaning
async findActiveGoalsByUser(userId: string): Promise<FinSavingsGoal[]> {
  return this.repository.findGoals({ userId, isActive: true });
}
```

### Comments

Do not leave comments that add no value. Prefer clear names and structure so the code explains itself. Comment only what is genuinely important and non-obvious: why a trade-off was made, a constraint the reader would miss, or a hazard that names alone cannot carry. Delete narration, restatements of the next line, and leftover TODOs that no longer mean anything.

```ts
// Bad — narrates the obvious
// find the account by id
const account = await this.repository.findAccount(id);

// Good — explains a non-obvious trade-off
// We re-read inside the transaction instead of trusting the row loaded by the
// controller: two taps can arrive in parallel and the second must see the first.
const current = await tx.finAccount.findFirst({ where: { id, userId } });
```

**Quick test before writing a comment:** if deleting it leaves the code just as clear, the comment isn't earning its place.

### No magic strings

Do not hard-code domain or protocol literals inline (status values, roles, path fragments, error codes, event names). Name them once — const, union, generated Prisma enum, or shared contract — and reuse that name. Exception: one-off strings with no reuse and no domain meaning (a single log label) may stay inline if a named constant would only obscure them.

```ts
// Bad — the event name is a literal in the publisher and again in the subscriber
this.events.emit('user.preferences.updated', payload);

// Good — named once in the shared contract (packages/core/src/events/event.constants.ts)
this.events.emit(AppEvents.USER_PREFERENCES_UPDATED, payload);
```

### SOLID

Apply with judgment. Favor single responsibility and inversion of dependencies (ports/adapters) where variation is real. Do not force every SOLID letter into every small file.

```ts
// Bad — the use case depends on a concrete SDK client
export class SendPush {
  async execute(userId: string, title: string) {
    await new FcmClient(this.config).send(userId, title);
  }
}

// Good — depends on a port, the adapter lives in infrastructure
export class SendPush {
  constructor(private readonly sender: PushSender) {}

  async execute(userId: string, title: string) {
    await this.sender.send({ userId, title });
  }
}
```

### Validate once

Validate at the boundary (the DTO plus the global `ValidationPipe`, or a Zod schema for an internal payload). Downstream code should trust that contract — do not re-check the same emptiness, type, or range in services, use cases, or repositories.

Bad smell: hand-rolled parsers that trim/null-check/re-parse what the boundary already guarantees, or a second layer validating the same rule again "just in case."

When a shared schema defines the input, that schema is the **single source of truth**. Do not stack a second validator for the same invariants.

```ts
// Bad — the DTO already validates, and the service re-checks the same rule
export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

async createAccount(userId: string, dto: CreateAccountDto) {
  if (!dto.name || dto.name.trim().length === 0) {
    throw new BadRequestException('name required'); // redundant re-validation
  }
  return this.repository.insertAccount(userId, dto);
}

// Good — the service trusts the contract the pipe already enforced
async createAccount(userId: string, dto: CreateAccountDto) {
  return this.repository.insertAccount(userId, dto);
}
```

When in doubt: **fail fast, keep it flat, keep it small.**

## TypeScript

### Strict typing

**No `any`.** It disables every check on the value and spreads to every caller. `@typescript-eslint/no-explicit-any` is on.

**`unknown` at the edge, validated before use.** A payload from outside (an HTTP body, a queue message, a webhook) is `unknown` until a schema proves its shape.

```ts
// Bad — an unchecked cast turns a runtime failure into a silent one
const payload = message.data as InvoiceSyncPayload;

// Good — unknown until the schema proves the shape
const parsed = invoiceSyncSchema.safeParse(message.data);
if (!parsed.success) {
  throw new Error(`Invalid invoice sync payload: ${parsed.error.message}`);
}
const payload: InvoiceSyncPayload = parsed.data;
```

**`as` only with a written reason.** A cast is a promise to the compiler that you know better. If the reason cannot be written in one line, the cast is hiding a design problem.

```ts
// Bad — silences the compiler, breaks when the object changes
const args = argsObject as CreateAccountDto;

// Good — the cast is narrow, local, and explained
// class-validator exposes the owning object, not the narrowed instance.
const dto = args.object as CreateAccountDto;
```

**`satisfies` for literal config.** It checks the shape without widening the literals, so the keys stay narrow and the config stays valid.

```ts
// Bad — the annotation widens every key to string
const BUDGET_PERIOD_LABEL: Record<BudgetPeriodType, string> = {
  MONTHLY: 'Mensual',
  BIWEEKLY: 'Quincenal',
  CUSTOM: 'Personalizado',
};

// Good — keys stay narrow and the shape is checked
const BUDGET_PERIOD_LABEL = {
  MONTHLY: 'Mensual',
  BIWEEKLY: 'Quincenal',
  CUSTOM: 'Personalizado',
} satisfies Record<BudgetPeriodType, string>;
```

**`readonly` for data you don't own.** A parameter, DTO field or return type that the function must not mutate is declared `readonly`, so the compiler rejects the mutation instead of the reviewer.

```ts
// Bad — the helper can sort the caller's array in place
export function totalsByStatus(
  rows: FinTransaction[],
): Map<string, Prisma.Decimal> {}

// Good — the signature forbids mutation
export function totalsByStatus(
  rows: readonly FinTransaction[],
): Map<string, Prisma.Decimal> {}
```

**Explicit return types on exported functions.** The return type is part of the contract. Leaving it inferred means a refactor inside the function silently changes what every caller gets. Internal one-liners may infer.

```ts
// Bad — the contract changes when the body changes
export function resolvePeriod(query: CreateBudgetDto) {
  return query.periodType ?? BUDGET_PERIOD_TYPE.MONTHLY;
}

// Good — the contract is written down
export function resolvePeriod(query: CreateBudgetDto): BudgetPeriodType {
  return query.periodType ?? BUDGET_PERIOD_TYPE.MONTHLY;
}
```

### Enums, unions and exhaustive switch

Use a `as const` object plus a union type for a closed set that crosses layers. It serializes as the string the API already sends, and it adds no runtime object.

```ts
// Bad — a local enum duplicates a closed set the repo already names
enum BudgetPeriodTypeValue {
  Monthly = 'MONTHLY',
  Biweekly = 'BIWEEKLY',
  Custom = 'CUSTOM',
}

// Good — one const object plus its union (planning/domain/budget-period.ts)
export const BUDGET_PERIOD_TYPE = {
  MONTHLY: 'MONTHLY',
  BIWEEKLY: 'BIWEEKLY',
  CUSTOM: 'CUSTOM',
} as const;

export type BudgetPeriodType =
  (typeof BUDGET_PERIOD_TYPE)[keyof typeof BUDGET_PERIOD_TYPE];
```

Prisma already generates the enum for a database column. Reuse that type instead of declaring a second copy: `$Enums.FinTransactionStatus` comes with the client, and the repository, the DTO and the switch share it.

A `switch` over a union ends in `never`. `@typescript-eslint/switch-exhaustiveness-check` reports a missing case; the `never` assignment makes the next added member a compile error instead of a silent no-op.

```ts
// Bad — a new status falls into the default and the bug ships
function applyStatus(
  status: $Enums.FinTransactionStatus,
  row: FinTransaction,
): FinTransaction {
  switch (status) {
    case 'CONFIRMED':
      return applyConfirmed(row);
    case 'CANCELLED':
      return applyCancelled(row);
    default:
      return row;
  }
}

// Good — the compiler rejects a new member until it is handled
function applyStatus(
  status: $Enums.FinTransactionStatus,
  row: FinTransaction,
): FinTransaction {
  switch (status) {
    case 'CONFIRMED':
      return applyConfirmed(row);
    case 'CANCELLED':
      return applyCancelled(row);
    default: {
      const unhandled: never = status;
      throw new Error(`Unhandled transaction status: ${String(unhandled)}`);
    }
  }
}
```

### Measurable limits

Limits are review rules first and lint rules second. The numbers below are the ones `eslint.config.mjs` enforces at `warn`.

| Limit                                    | Value              |
| ---------------------------------------- | ------------------ |
| Lines per function                       | 120                |
| Lines per file (without blanks/comments) | 300                |
| Parameters per function                  | 3, then one object |
| Nesting depth                            | 4                  |
| Cyclomatic complexity                    | 12                 |
| Nested ternaries                         | none               |

A function past 120 lines or complexity 12 usually hides two responsibilities. Extract by intent, not by line count: if the extracted name does not let the caller skip the body, the split made it worse.

**Three parameters, then an object.** Positional arguments stop being readable at the fourth, and two call sites always end up swapping the order.

```ts
// Bad — four positional arguments, two of them booleans
async listTransactions(userId: string, from: Date, to: Date, onlyManual: boolean) {}

// Good — one object, each value named at the call site
type ListTransactionsQuery = {
  userId: string;
  from: Date;
  to: Date;
  onlyManual: boolean;
};

async listTransactions(query: ListTransactionsQuery) {}
```

A Nest constructor with more than three injected dependencies also trips the rule, and that warning is useful: the class is doing too much.

**No boolean parameter that flips behavior.** A `true` at the call site says nothing, and the function grows a second path nobody reviews.

```ts
// Bad — the caller has to remember what `true` means
await this.accounts.archive(accountId, true);

// Good — the name says what happens
await this.accounts.archiveWithTransfers(accountId);
```

**No nested ternary.** One conditional expression is fine. Two is a puzzle.

```ts
// Bad
const label =
  kind === 'CARD' ? 'Tarjeta' : kind === 'CASH' ? 'Efectivo' : 'Cuenta';

// Good — a lookup table says it once
const INSTRUMENT_LABEL = {
  CARD: 'Tarjeta',
  CASH: 'Efectivo',
  ACCOUNT: 'Cuenta',
} satisfies Record<InstrumentKind, string>;
const label = INSTRUMENT_LABEL[kind];
```

### Async and promises

**No floating promises.** A promise that nobody awaits or handles rejects into an unhandled rejection, far from the line that caused it. Either `await` it, return it, or mark it `void` on purpose.

```ts
// Bad — the error disappears
this.push.send(userId, 'Cuenta creada');

// Good — awaited inside the flow that needs it
await this.push.send(userId, 'Cuenta creada');

// Good — deliberately fire-and-forget, with `void` and a comment when it matters
void this.audit.record(userId, 'account.created');
```

**No `async` callback in `forEach`.** `forEach` ignores the returned promise: the loop finishes before the work does, and the first rejection is lost. Use `for...of` when the order matters, `Promise.all` with `map` when it does not.

```ts
// Bad — the request resolves before the rows are written
rows.forEach(async (row) => {
  await this.repository.save(row);
});

// Good — sequential when each step depends on the previous one
for (const row of rows) {
  await this.repository.save(row);
}

// Good — parallel when the rows are independent
await Promise.all(rows.map((row) => this.repository.save(row)));
```

**Parallelize what is independent.** Two queries that do not depend on each other cost one round trip, not two.

```ts
// Bad — sequential for no reason
const profile = await this.users.findProfile(userId);
const accounts = await this.catalog.listAccounts(userId);

// Good — independent reads in parallel
const [profile, accounts] = await Promise.all([
  this.users.findProfile(userId),
  this.catalog.listAccounts(userId),
]);
```

Do not parallelize writes that must land together. Those belong in one `$transaction`.

### Naming conventions

| Kind                       | Convention                      | Example                            |
| -------------------------- | ------------------------------- | ---------------------------------- |
| File                       | kebab-case, role last           | `allocate-to-goal.use-case.ts`     |
| Class, interface, type     | PascalCase                      | `FinanceOwnershipService`          |
| Function, method, variable | camelCase, verb first           | `findActiveGoalsByUser`            |
| Constant, module literal   | SCREAMING_SNAKE_CASE            | `MAX_PAGE_LIMIT`                   |
| Boolean                    | `is` / `has` / `can` / `should` | `hasCategories`, `isPending`       |
| Port (interface)           | role noun, no `I` prefix        | `PushSender`, `PlanningRepository` |
| Adapter (implementation)   | technology first, then role     | `PrismaPlanningRepository`         |

A name that needs the type to be understood is a bad name. `userIds: string[]` is fine without `Array` or `List` in the name.

### What makes a good test

A test states one behavior, arranges the smallest state that produces it, and fails with a message that names the broken rule. In this repo tests are Jest specs next to the unit (`*.spec.ts`) and live under `test/` when they need the app.

- **One behavior per `it`.** "creates the account and sends the push and rolls back" is three tests.
- **The name says what is guaranteed**, not which method ran: `it('rejects a transfer above the account balance')`, not `it('tests createTransfer')`.
- **Arrange, Act, Assert, visibly separated.** A helper that builds a valid fixture is good; a helper that hides the assertion is not.
- **Mock the boundary you do not own** (Prisma, HTTP, the clock). Do not mock the unit under test.
- **Assert on the observable result**: the returned value, the row that was written, the error that was thrown. Asserting on an internal call order breaks on every refactor and proves nothing.
- **One assertion that would catch the regression** beats ten that restate the implementation.
- **Every bug fix starts with the test that fails.** If the test does not fail before the fix, it is not covering the bug.

```ts
describe('AllocateToGoalUseCase', () => {
  it('rejects an allocation above the account balance', async () => {
    const { useCase } = setup({ balance: 500, earmarked: 0 });

    await expect(useCase.execute(transferAboveBalance)).rejects.toThrow(
      'Insufficient balance',
    );
  });

  it('writes one contribution row per allocation', async () => {
    const { useCase, repository } = setup({ balance: 5000, earmarked: 0 });

    await useCase.execute(validTransfer);

    expect(repository.addSavingsGoalContribution).toHaveBeenCalledTimes(1);
  });
});
```

## NestJS and Prisma

### Thin controllers

A controller maps HTTP to a call: read the user and the validated DTO, ask a service, return the result. It does not decide business rules, build Prisma queries, or catch-and-rewrite errors. `AllExceptionsFilter` already turns an exception into the response envelope.

```ts
// Bad — the controller holds the rule, the transaction and the response shape
@Post('accounts/:id/close')
async close(@CurrentUser('sub') userId: string, @Param('id') id: string) {
  const account = await this.prisma.finAccount.findFirst({ where: { id, userId } });
  if (!account) {
    throw new NotFoundException();
  }
  if (account.balance !== '0') {
    throw new BadRequestException('Account still has a balance');
  }
  await this.prisma.finAccount.update({ where: { id }, data: { isActive: false } });
  return { data: { closed: true } };
}

// Good — the controller only maps the request
@Post('accounts/:id/close')
@ApiOkResponse({ type: CloseAccountResponseDto })
close(@CurrentUser('sub') userId: string, @Param('id') id: string) {
  return this.catalog.closeAccount(userId, id);
}
```

### Transactions across tables

A write that touches more than one table goes through one `$transaction`, so a failure leaves no half-written state. Pass the transaction client (`tx`) down to every statement inside; a call that uses `this.prisma` inside the callback escapes the transaction without warning.

```ts
// Bad — the second write can fail and leave an orphan ledger entry
await this.prisma.finTransaction.create({ data: entry });
await this.prisma.finAccount.update({ where: { id }, data: { balance } });

// Good — both writes land or neither does
await this.prisma.$transaction(async (tx) => {
  await tx.finTransaction.create({ data: entry });
  await tx.finAccount.update({ where: { id }, data: { balance } });
});
```

Rules that keep the transaction honest:

- Inside the callback, use only `tx`. Never `this.prisma`.
- Re-read the row you are about to change when two requests can race; do not trust the copy loaded before the transaction.
- Keep the callback short. No HTTP calls, no push notifications, no AI calls inside: they hold the connection open and cannot be rolled back.
- A read-only multi-step consistency check may use `$transaction` with isolation, but a single aggregate does not need one.

### Avoid N+1

One query for the page, not one query per row. `include`/`select` for relations that the response needs, and `in` for a set of ids.

```ts
// Bad — one query per installment row
const loans = await this.prisma.finLoan.findMany({ where: { userId } });
for (const loan of loans) {
  loan.installments = await this.prisma.finLoanInstallment.findMany({
    where: { loanId: loan.id },
  });
}

// Good — one query, the relation comes with the page
const loans = await this.prisma.finLoan.findMany({
  where: { userId },
  include: { installments: { orderBy: { dueDate: 'asc' } } },
});
```

```ts
// Bad — one query per category id
const categories = await Promise.all(
  categoryIds.map((categoryId) =>
    this.prisma.finCategory.findUnique({ where: { id: categoryId } }),
  ),
);

// Good — one query for the whole set
const categories = await this.prisma.finCategory.findMany({
  where: { id: { in: categoryIds }, userId },
});
```

Inside a paginated list, a query per item multiplies with the page size. If you add a relation to the response, add it to the `include` of the list query that already exists.

### DTOs and validation

A request body, query or route param is a DTO validated by `class-validator`. The global `ValidationPipe` (`transform`, `whitelist`, `forbidNonWhitelisted`) rejects unknown fields and missing decorators, so the service receives a value that already matches the type.

The closed set lives in one `as const` next to the DTO (`budgetPeriods` in `planning/presentation/dto/create-budget.dto.ts`), and `@IsEnum` reads that same constant.

```ts
// Bad — no decorators: the pipe has nothing to enforce and the field is stripped
export class UpdateBudgetDto {
  amountLimit: string;
}

// Good — every incoming field has a rule and a Swagger description
export class UpdateBudgetDto {
  @ApiPropertyOptional({ example: '2500.00' })
  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/)
  amountLimit?: string;

  @ApiPropertyOptional({ enum: budgetPeriods })
  @IsOptional()
  @IsEnum(budgetPeriods)
  periodType?: (typeof budgetPeriods)[number];
}
```

- `whitelist: true` strips a field with no decorator instead of trusting it. `forbidNonWhitelisted: true` turns it into a 400.
- A cross-field rule (this field required when that one is set) is a `@Validate` constraint on the DTO, not an `if` in the service.
- The response type is a separate DTO with `@ApiProperty`. Do not return the Prisma row as-is: it leaks columns you did not mean to publish.
- An internal payload (a queue message, a tool argument) is validated with Zod where it enters, and then travels typed.

### Security and logs

**The logger is structured.** Use `PinoLogger` with an object first and a short message second. A concatenated string loses the fields the log pipeline filters on.

```ts
// Bad — a string, and the account number ends up in the log
this.logger.error(
  `Failed to charge account ${account.accountNumber}: ${error.message}`,
);

// Good — fields stay queryable, the sensitive value is not there
this.logger.error(
  { accountId: account.id, requestId, error: error.message },
  'Failed to charge account',
);
```

- **Never log** a password, token, access token, refresh token, service key, full account number, full card number or full email. Log the id; if you need correlation, log a masked value.
- **The user gets a generic message, the log gets the detail.** An unexpected failure answers `500` with a stable code; the stack, the SQL error and the ids go to the logger and Sentry. `AllExceptionsFilter` already does this: do not add the exception message to the response.
- **A thrown `HttpException` (4xx) is expected.** Do not log it as an error; Sentry only needs the 5xx. A `401`, `403` or `404` is normal traffic.
- **Messages are in Spanish for the user and in English for the developer**, matching the rest of the repo: the response body is user-facing, the log line is not.
- A new environment variable is declared in `packages/config/src/env.schema.ts` with Zod. Never read `process.env` directly in a service.

### Money

An amount is `Prisma.Decimal` from the database to the response. `number` is only for a ratio or a display value that has already been rounded.

```ts
// Bad — float arithmetic drifts and the guard rejects it
const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);

// Good — exact decimal arithmetic through the shared helpers
const total = sumMoney(rows.map((row) => row.amount));
```

- Sum, subtract, round and compare with the helpers in `packages/finance/src/shared/domain/money.ts`. `pnpm lint:money` and the `no-restricted-syntax` block in `eslint.config.mjs` reject `Number(...)` and `.toNumber()` on the finance read paths.
- The HTTP contract sends an amount as a string with two decimals (ADR-002). Do not serialize a `Decimal` through `JSON.parse` and lose precision.
- Round with `ROUND_HALF_EVEN` and only at the end of a calculation, not on every step.
- Two currencies are never summed. Convert with the FX rate first and record the rate you used.

### Dates and timezones

A date calculation names its timezone. The server runs in UTC; the user lives in a local zone; "today" is not the same day in both.

```ts
// Bad — today depends on where the process runs
const today = new Date().toISOString().slice(0, 10);

// Good — the user's calendar day, computed with their zone
const today = localDateIso(profile.timezone, new Date());
```

- Store timestamps in UTC (`timestamp` or `timestamptz`), and a calendar date as a date-only column or the ISO string the API sends.
- Use `localDateIso` / `localDayStart` from `packages/finance/src/shared/domain/local-day.ts` for a user's calendar day. `America/Santo_Domingo` is the default only when the profile has no zone.
- Never build a date by adding milliseconds for a "day". A week across a DST change has 167 or 169 hours.
- A comparison between two dates says whether it compares instants or calendar days; mixing them is how off-by-one-day bugs ship.
- A date in a response is ISO-8601 with the offset, or document that it is a date-only value.

## Guide rule to ESLint rule

The rules below are active in `eslint.config.mjs`. Anything new enters at `warn` until the existing backlog is clean.

| Guide rule                                | ESLint rule                                      | Level |
| ----------------------------------------- | ------------------------------------------------ | ----- |
| No `any`                                  | `@typescript-eslint/no-explicit-any`             | warn  |
| Function at most 120 lines                | `max-lines-per-function`                         | warn  |
| File at most 300 lines                    | `max-lines`                                      | warn  |
| At most 3 parameters, then one object     | `max-params`                                     | warn  |
| Nesting at most 4 levels                  | `max-depth`                                      | warn  |
| Cyclomatic complexity at most 12          | `complexity`                                     | warn  |
| No nested ternaries                       | `no-nested-ternary`                              | warn  |
| Every promise awaited or handled          | `@typescript-eslint/no-floating-promises`        | warn  |
| No async callback in `forEach`            | `@typescript-eslint/no-misused-promises`         | warn  |
| Exhaustive `switch`, no silent `default`  | `@typescript-eslint/switch-exhaustiveness-check` | warn  |
| Braces on every `if`                      | `curly`                                          | error |
| Money never through `number`              | `no-restricted-syntax` + `pnpm lint:money`       | error |
| Import another package through its barrel | `no-restricted-imports`                          | error |
| `contracts` stays framework-free          | `no-restricted-imports`                          | error |

Reviewed by a person, because no reliable rule exists:

- `as` with a written reason, and `unknown` validated before use.
- `readonly` in a signature, and explicit return types on exported functions.
- Boolean names (`is` / `has` / `can` / `should`) and no boolean parameter that flips behavior.
- A test that states one behavior and would fail on the regression.
- A controller that only maps the request, and a transaction that uses only `tx`.
- Structured log fields and no sensitive value in the message.
