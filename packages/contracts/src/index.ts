// No Nest, Prisma, Zod, SDK or domain imports.
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type IsoInstant = string;

export const INFERENCE_COMPLETION = Symbol.for(
  'personal-os.contracts.inference-completion',
);
export const MODULE_SETTINGS_READER = Symbol.for(
  'personal-os.contracts.module-settings-reader',
);
export const NOTIFICATION_INTENT_SINK = Symbol.for(
  'personal-os.contracts.notification-intent-sink',
);
export const DOMAIN_EVENT_PUBLISHER = Symbol.for(
  'personal-os.contracts.domain-event-publisher',
);
export const AI_CAPABILITY_REGISTRY = Symbol.for(
  'personal-os.contracts.ai-capability-registry',
);

export interface InferenceMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}
export interface InferenceCompletion {
  content: string;
  provider: string;
  model: string;
}
// AI-0 adapter delegates to the preserved pool; AI-1 adds structured inference.
export interface InferenceCompletionPort {
  complete(messages: readonly InferenceMessage[]): Promise<InferenceCompletion>;
}

export interface SettingsDescriptor<T extends JsonObject = JsonObject> {
  readonly slug: string;
  readonly version: number;
  readonly defaults: Readonly<T>;
  // Module-owned migration/merge/validation; registry has no business fields.
  normalize(stored: unknown): T;
  applyPatch(current: T, patch: unknown): T;
  notificationEnabled(config: T, key: string): boolean;
}
export interface ModuleSettingsReader {
  read(
    userId: string,
    slug: string,
  ): Promise<{ enabled: boolean; version: number; config: JsonObject }>;
  notificationEnabled(
    userId: string,
    slug: string,
    key: string,
  ): Promise<boolean>;
}

export interface DomainEvent<T extends JsonObject = JsonObject> {
  eventId: string;
  eventName: string;
  version: number;
  occurredAt: IsoInstant;
  userId: string | null;
  aggregateType: string;
  aggregateId: string;
  payload: T;
}
// The infrastructure supplies its transaction type; contracts never import it.
export interface DomainEventPublisher<TTransaction> {
  enqueue(event: DomainEvent, tx: TTransaction): Promise<void>;
}

export interface NotificationIntent {
  schemaVersion: 1;
  userId: string;
  sourceDomain: string;
  type: string;
  preferenceKey?: string;
  title: string;
  body: string;
  data?: JsonObject;
  requestedChannels: readonly ('IN_APP' | 'PUSH' | 'EMAIL')[];
  deduplicationKey: string;
  occurredAt: IsoInstant;
  cause?: { eventId: string; eventName: string };
}
export interface IntentProducer<TEvent = DomainEvent> {
  toIntents(event: TEvent): readonly NotificationIntent[];
}
export interface NotificationIntentSink {
  submit(
    intent: NotificationIntent,
  ): Promise<{ accepted: boolean; notificationIds: readonly string[] }>;
}

export interface AiCapabilityDefinition {
  id: string;
  moduleSlug: string;
  version: number;
  description: string;
  inputSchema: JsonObject;
  effect: 'READ' | 'WRITE';
}
export interface AiExecutionContext {
  // Set by the host from verified auth/signal ownership, never from tool args.
  userId: string;
  invocationId: string;
  correlationId: string;
  authorization?: {
    actionId: string;
    capabilityId: string;
    argumentDigest: string;
    policyVersion: string;
    decision: 'AUTO_ALLOWED' | 'CONFIRM_REQUIRED';
  };
}
export interface AiCapabilityProvider {
  readonly moduleSlug: string;
  describe(): readonly AiCapabilityDefinition[];
  execute(
    ctx: AiExecutionContext,
    capabilityId: string,
    args: unknown,
  ): Promise<JsonValue>;
  resolveEntity?(
    ctx: AiExecutionContext,
    ref: { type: string; id: string },
  ): Promise<JsonValue>;
  readContext?(ctx: AiExecutionContext): Promise<JsonObject>;
}

// A signal remains an intelligence record, not a domain event or intent.
export interface RoutedSignal<T extends JsonObject = JsonObject> {
  signalId: string;
  userId: string;
  signalType: string;
  schemaVersion: number;
  occurredAt: IsoInstant;
  payload: T;
}
export interface SignalConsumer<T extends JsonObject = JsonObject> {
  consume(signal: RoutedSignal<T>): Promise<{
    outcome: 'APPLIED' | 'ALREADY_APPLIED' | 'REVIEW_REQUIRED' | 'REJECTED';
    domainReferences: readonly { type: string; id: string }[];
  }>;
}
