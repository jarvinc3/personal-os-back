import type { AiActionPolicy } from './ai-conversation';
import type { JsonObject, JsonValue } from './primitives';

export const AI_CAPABILITY_REGISTRY = Symbol.for(
  'personal-os.contracts.ai-capability-registry',
);
export const AI_CAPABILITY_PROVIDERS = Symbol.for(
  'personal-os.contracts.ai-capability-providers',
);

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
  ): Promise<JsonValue | null>;
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
  resolveEntity?(
    ctx: AiExecutionContext,
    ref: { type: string; id: string },
  ): Promise<JsonValue | null>;
}
