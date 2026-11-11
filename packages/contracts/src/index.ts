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
export const MODULE_SETTINGS_REGISTRY = Symbol.for(
  'personal-os.contracts.module-settings-registry',
);
export const NOTIFICATION_INTENT_SINK = Symbol.for(
  'personal-os.contracts.notification-intent-sink',
);
export const NOTIFICATION_INTENT_CONSUMER = Symbol.for(
  'personal-os.contracts.notification-intent-consumer',
);
export const DOMAIN_EVENT_PUBLISHER = Symbol.for(
  'personal-os.contracts.domain-event-publisher',
);
export const AI_CAPABILITY_REGISTRY = Symbol.for(
  'personal-os.contracts.ai-capability-registry',
);
export const AI_CAPABILITY_PROVIDERS = Symbol.for(
  'personal-os.contracts.ai-capability-providers',
);
export const AI_CONVERSATION_INFERENCE = Symbol.for(
  'personal-os.contracts.ai-conversation-inference',
);

export type AiToolCall = {
  id: string;
  name: string;
  arguments: JsonObject;
};

export interface AiConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: readonly AiToolCall[];
}

export interface AiToolSpec {
  name: string;
  description: string;
  parameters: JsonObject;
  moduleSlug: string;
  effect: 'READ' | 'WRITE';
  actionPolicy?: AiActionPolicy;
}

export type AiActionPolicy = 'AUTO_ALLOWED' | 'CONFIRM_REQUIRED' | 'FORBIDDEN';

export const AI_ACTION_POLICY_VERSION = 'ai-10-v1';

export interface AiConversationCompletion {
  content: string;
  toolCalls: readonly AiToolCall[];
  provider: string;
  model: string;
}

export interface AiConversationInferencePort {
  complete(
    messages: readonly AiConversationMessage[],
    tools?: readonly AiToolSpec[],
  ): Promise<AiConversationCompletion>;
  summarize(messages: readonly AiConversationMessage[]): Promise<string>;
}

export interface InferenceMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}
export interface InferenceCompletion {
  content: string;
  provider: string;
  model: string;
}
export interface StructuredInferenceRequest<T> {
  task: string;
  messages: readonly InferenceMessage[];
  jsonSchema: JsonObject;
  validate(value: unknown): T;
  promptVersion: string;
  schemaVersion: string;
  userId?: string;
  sourceType?: string;
  sourceId?: string;
  preferredProvider?: string | null;
  /**
   * La telemetría de inferencia se guarda por defecto. Una vista previa la
   * apaga para no dejar rastro de una corrida que no debe escribir nada.
   */
  recordTelemetry?: boolean;
}
export interface StructuredInference<T> {
  value: T;
  provider: string;
  model: string;
  latencyMs: number;
  fallbackCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
}
export class StructuredInferenceOutputError extends Error {
  readonly code = 'STRUCTURED_OUTPUT_INVALID';

  constructor(
    readonly provider: string | null = null,
    readonly model: string | null = null,
    readonly attempts = 0,
    /**
     * Causa acotada para diagnóstico: `INVALID_JSON` o `SCHEMA_VALIDATION:` con
     * los campos rechazados. Nunca incluye el contenido del modelo.
     */
    readonly detail: string | null = null,
  ) {
    super('The model output did not match the required structured schema');
    this.name = 'StructuredInferenceOutputError';
  }
}
export class StructuredInferenceProviderError extends Error {
  readonly code = 'INFERENCE_PROVIDER_FAILURE';

  constructor(
    readonly retryable: boolean,
    readonly provider: string | null = null,
    readonly model: string | null = null,
    readonly attempts = 0,
    readonly httpStatus: number | null = null,
  ) {
    super('AI inference provider unavailable');
    this.name = 'StructuredInferenceProviderError';
  }
}
// AI-0 preserved the provider pool; AI-1 adds structured, validated inference.
export interface InferenceCompletionPort {
  complete(messages: readonly InferenceMessage[]): Promise<InferenceCompletion>;
  infer<T>(
    request: StructuredInferenceRequest<T>,
  ): Promise<StructuredInference<T>>;
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
export interface ModuleSettingsRegistry {
  register(descriptor: SettingsDescriptor): void;
  get(slug: string): SettingsDescriptor;
  list(): readonly SettingsDescriptor[];
  normalize(slug: string, stored: unknown): JsonObject;
  applyPatch(slug: string, current: unknown, patch: unknown): JsonObject;
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
export { createSettingsDescriptor } from './module-settings';

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
export interface NotificationIntentConsumer {
  accept(input: unknown): NotificationIntent;
}

export interface AiCapabilityDefinition {
  id: string;
  moduleSlug: string;
  version: number;
  description: string;
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  effect: 'READ' | 'WRITE';
  actionPolicy?: AiActionPolicy;
  validateInput(value: unknown): JsonObject;
  validateOutput(value: unknown): JsonValue;
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
    decision: Exclude<AiActionPolicy, 'FORBIDDEN'>;
  };
}
export interface AiCapabilityProvider {
  readonly moduleSlug: string;
  describe(): readonly AiCapabilityDefinition[];
  isAvailable?(ctx: AiExecutionContext): boolean | Promise<boolean>;
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

export type AiCapabilityDescriptor = Omit<
  AiCapabilityDefinition,
  'validateInput' | 'validateOutput'
>;

export type AiCapabilityErrorCode =
  | 'CAPABILITY_CONFLICT'
  | 'CAPABILITY_NOT_FOUND'
  | 'CAPABILITY_UNAVAILABLE'
  | 'CAPABILITY_INVALID_ARGUMENTS'
  | 'CAPABILITY_INVALID_OUTPUT'
  | 'CAPABILITY_EXECUTION_FAILED'
  | 'CAPABILITY_CONTEXT_UNAVAILABLE'
  | 'CAPABILITY_INVALID_DEFINITION'
  | 'CAPABILITY_MUTATION_POLICY_REQUIRED';

export class AiCapabilityError extends Error {
  constructor(
    readonly code: AiCapabilityErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'AiCapabilityError';
  }
}

export interface AiCapabilityRegistryPort {
  register(provider: AiCapabilityProvider): void;
  discover(moduleSlug?: string): readonly AiCapabilityDescriptor[];
  execute(
    ctx: AiExecutionContext,
    capabilityId: string,
    args: unknown,
  ): Promise<JsonValue>;
  validateInput(capabilityId: string, args: unknown): JsonObject;
  readContext(ctx: AiExecutionContext, moduleSlug: string): Promise<JsonObject>;
}

// A signal remains an intelligence record, not a domain event or intent.
export interface RoutedSignal<T extends JsonObject = JsonObject> {
  signalId: string;
  userId: string;
  signalType: string;
  schemaVersion: number;
  occurredAt: IsoInstant;
  sourceType: string;
  sourceId: string;
  payload: T;
}
/**
 * Lo que un consumidor haría con una señal, sin escribir nada. Lo usan las
 * vistas previas: el resultado sale del mismo paso de decisión que la escritura.
 */
export interface SignalImportPreview {
  outcome: 'APPLIED' | 'ALREADY_APPLIED' | 'REVIEW_REQUIRED' | 'REJECTED';
  reason?: string;
  domainReferences?: readonly { type: string; id: string }[];
  cardPayment?: {
    sourceAccountId: string;
    cardId: string;
    amount: number;
    currency: string;
    status: string;
    transactionDate: string;
    description: string;
    externalReference: string | null;
    importReference: string;
  };
  movement?: {
    accountId: string | null;
    cardId: string | null;
    amount: number;
    currency: string;
    type: string;
    status: string;
    transactionDate: string;
    description: string;
    categoryId: string | null;
    legRole: string | null;
    externalReference: string | null;
    importReference: string;
  };
}

export interface SignalConsumer<T extends JsonObject = JsonObject> {
  readonly domain: string;
  consume(signal: RoutedSignal<T>): Promise<{
    outcome: 'APPLIED' | 'ALREADY_APPLIED' | 'REVIEW_REQUIRED' | 'REJECTED';
    domainReferences: readonly { type: string; id: string }[];
    reason?: string;
  }>;
  /** Opcional: solo los consumidores que pueden decidir sin escribir. */
  preview?(signal: RoutedSignal<T>): Promise<SignalImportPreview>;
}
