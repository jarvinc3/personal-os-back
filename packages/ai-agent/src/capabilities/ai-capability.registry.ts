import { Injectable } from '@nestjs/common';
import {
  AI_ACTION_POLICY_VERSION,
  AiCapabilityError,
  type AiCapabilityDefinition,
  type AiCapabilityDescriptor,
  type AiCapabilityProvider,
  type AiCapabilityRegistryPort,
  type AiExecutionContext,
  type JsonObject,
  type JsonValue,
} from '@personal-os/contracts';
import { aiActionArgumentDigest } from '../actions/application/ai-action-argument-digest';
import { AiActionsRepository } from '../actions/infrastructure/ai-actions.repository';

type RegisteredCapability = {
  provider: AiCapabilityProvider;
  definition: AiCapabilityDefinition;
};

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === 'object') {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    isJsonValue(value)
  );
}

function cloneSchema(schema: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(schema)) as JsonObject;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Capability provider failed';
}

@Injectable()
export class AiCapabilityRegistry implements AiCapabilityRegistryPort {
  private readonly capabilities = new Map<string, RegisteredCapability>();
  private readonly providers = new Map<string, AiCapabilityProvider[]>();
  private readonly registeredInstances = new WeakSet<AiCapabilityProvider>();

  constructor(private readonly actions: AiActionsRepository) {}

  register(provider: AiCapabilityProvider): void {
    if (
      typeof provider.moduleSlug !== 'string' ||
      !provider.moduleSlug.trim() ||
      this.registeredInstances.has(provider)
    ) {
      throw new AiCapabilityError(
        'CAPABILITY_CONFLICT',
        `Capability provider is already registered or has no module slug`,
        { moduleSlug: provider.moduleSlug },
      );
    }

    let definitions: readonly AiCapabilityDefinition[];
    try {
      definitions = provider.describe();
    } catch (error) {
      throw new AiCapabilityError(
        'CAPABILITY_INVALID_DEFINITION',
        `Could not describe capabilities for ${provider.moduleSlug}: ${errorMessage(error)}`,
        { moduleSlug: provider.moduleSlug },
      );
    }
    if (!Array.isArray(definitions)) {
      throw new AiCapabilityError(
        'CAPABILITY_INVALID_DEFINITION',
        `Capability provider ${provider.moduleSlug} must return an array of definitions`,
        { moduleSlug: provider.moduleSlug },
      );
    }

    const pending = new Set<string>();
    for (const definition of definitions) {
      if (
        typeof definition.id !== 'string' ||
        !definition.id.trim() ||
        definition.moduleSlug !== provider.moduleSlug ||
        !Number.isInteger(definition.version) ||
        definition.version < 1 ||
        typeof definition.description !== 'string' ||
        !definition.description.trim() ||
        !isJsonObject(definition.inputSchema) ||
        !isJsonObject(definition.outputSchema) ||
        !['READ', 'WRITE'].includes(definition.effect) ||
        (definition.effect === 'WRITE' &&
          !['AUTO_ALLOWED', 'CONFIRM_REQUIRED', 'FORBIDDEN'].includes(
            definition.actionPolicy ?? '',
          )) ||
        (definition.effect === 'READ' &&
          definition.actionPolicy !== undefined) ||
        typeof definition.validateInput !== 'function' ||
        typeof definition.validateOutput !== 'function'
      ) {
        throw new AiCapabilityError(
          'CAPABILITY_INVALID_DEFINITION',
          `Invalid capability definition from ${provider.moduleSlug}`,
          { moduleSlug: provider.moduleSlug, capabilityId: definition.id },
        );
      }
      if (this.capabilities.has(definition.id) || pending.has(definition.id)) {
        throw new AiCapabilityError(
          'CAPABILITY_CONFLICT',
          `Capability ${definition.id} is already registered`,
          { capabilityId: definition.id, moduleSlug: definition.moduleSlug },
        );
      }
      pending.add(definition.id);
    }

    this.registeredInstances.add(provider);
    const moduleProviders = this.providers.get(provider.moduleSlug) ?? [];
    moduleProviders.push(provider);
    this.providers.set(provider.moduleSlug, moduleProviders);
    for (const definition of definitions) {
      this.capabilities.set(definition.id, { provider, definition });
    }
  }

  discover(moduleSlug?: string): readonly AiCapabilityDescriptor[] {
    return [...this.capabilities.values()]
      .filter(
        ({ definition }) => !moduleSlug || definition.moduleSlug === moduleSlug,
      )
      .map(({ definition }) => ({
        id: definition.id,
        moduleSlug: definition.moduleSlug,
        version: definition.version,
        description: definition.description,
        inputSchema: cloneSchema(definition.inputSchema),
        outputSchema: cloneSchema(definition.outputSchema),
        effect: definition.effect,
        ...(definition.actionPolicy
          ? { actionPolicy: definition.actionPolicy }
          : {}),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async execute(
    ctx: AiExecutionContext,
    capabilityId: string,
    args: unknown,
  ): Promise<JsonValue> {
    const registered = this.capabilities.get(capabilityId);
    if (!registered) {
      throw new AiCapabilityError(
        'CAPABILITY_NOT_FOUND',
        `Capability ${capabilityId} is not registered`,
        { capabilityId },
      );
    }
    await this.assertAvailable(registered.provider, ctx);
    const validatedArgs = this.validateInput(capabilityId, args);

    if (registered.definition.effect === 'WRITE') {
      const authorization = ctx.authorization;
      const allowedPolicy = registered.definition.actionPolicy;
      if (
        !authorization?.actionId ||
        !authorization.argumentDigest ||
        authorization.capabilityId !== capabilityId ||
        authorization.policyVersion !== AI_ACTION_POLICY_VERSION ||
        authorization.decision !== allowedPolicy ||
        authorization.argumentDigest !== aiActionArgumentDigest(validatedArgs)
      ) {
        throw new AiCapabilityError(
          'CAPABILITY_MUTATION_POLICY_REQUIRED',
          `Capability ${capabilityId} requires an authorized AI action`,
          { capabilityId },
        );
      }
      const claimed = await this.actions.findClaimedForExecution({
        id: authorization.actionId,
        userId: ctx.userId,
        actionType: capabilityId,
        policy: authorization.decision,
        policyVersion: authorization.policyVersion,
        argumentDigest: authorization.argumentDigest,
      });
      if (!claimed) {
        throw new AiCapabilityError(
          'CAPABILITY_MUTATION_POLICY_REQUIRED',
          `Capability ${capabilityId} requires a claimed AI action`,
          { capabilityId },
        );
      }
    }

    let result: JsonValue;
    try {
      result = await registered.provider.execute(
        ctx,
        capabilityId,
        validatedArgs,
      );
    } catch (error) {
      if (error instanceof AiCapabilityError) {
        throw error;
      }
      throw new AiCapabilityError(
        'CAPABILITY_EXECUTION_FAILED',
        `Capability ${capabilityId} failed: ${errorMessage(error)}`,
        { capabilityId },
      );
    }

    try {
      const validatedOutput = registered.definition.validateOutput(result);
      if (!isJsonValue(validatedOutput)) {
        throw new Error('Output validator must return a JSON value');
      }
      return validatedOutput;
    } catch (error) {
      throw new AiCapabilityError(
        'CAPABILITY_INVALID_OUTPUT',
        `Invalid output for capability ${capabilityId}: ${errorMessage(error)}`,
        { capabilityId },
      );
    }
  }

  validateInput(capabilityId: string, args: unknown): JsonObject {
    const registered = this.capabilities.get(capabilityId);
    if (!registered) {
      throw new AiCapabilityError(
        'CAPABILITY_NOT_FOUND',
        `Capability ${capabilityId} is not registered`,
        { capabilityId },
      );
    }
    try {
      const validatedArgs = registered.definition.validateInput(args);
      if (!isJsonObject(validatedArgs)) {
        throw new Error('Input validator must return a JSON object');
      }
      return validatedArgs;
    } catch (error) {
      throw new AiCapabilityError(
        'CAPABILITY_INVALID_ARGUMENTS',
        `Invalid arguments for capability ${capabilityId}: ${errorMessage(error)}`,
        { capabilityId },
      );
    }
  }

  async readContext(
    ctx: AiExecutionContext,
    moduleSlug: string,
  ): Promise<JsonObject> {
    const providers = this.providers.get(moduleSlug) ?? [];
    let unavailable = false;
    for (const provider of providers) {
      if (!(await this.isAvailable(provider, ctx))) {
        unavailable = true;
        continue;
      }
      if (!provider.readContext) {
        continue;
      }
      try {
        const context = await provider.readContext(ctx);
        if (!isJsonObject(context)) {
          throw new Error('Context provider must return a JSON object');
        }
        return context;
      } catch (error) {
        throw new AiCapabilityError(
          'CAPABILITY_CONTEXT_UNAVAILABLE',
          `Context for module ${moduleSlug} is unavailable: ${errorMessage(error)}`,
          { moduleSlug },
        );
      }
    }
    if (unavailable) {
      throw new AiCapabilityError(
        'CAPABILITY_UNAVAILABLE',
        `Module ${moduleSlug} is unavailable for this user`,
        { moduleSlug },
      );
    }
    throw new AiCapabilityError(
      'CAPABILITY_CONTEXT_UNAVAILABLE',
      `Module ${moduleSlug} has no available context provider`,
      { moduleSlug },
    );
  }

  private async assertAvailable(
    provider: AiCapabilityProvider,
    ctx: AiExecutionContext,
  ): Promise<void> {
    if (await this.isAvailable(provider, ctx)) {
      return;
    }
    throw new AiCapabilityError(
      'CAPABILITY_UNAVAILABLE',
      `Module ${provider.moduleSlug} is unavailable for this user`,
      { moduleSlug: provider.moduleSlug },
    );
  }

  private async isAvailable(
    provider: AiCapabilityProvider,
    ctx: AiExecutionContext,
  ): Promise<boolean> {
    try {
      return provider.isAvailable ? await provider.isAvailable(ctx) : true;
    } catch {
      return false;
    }
  }
}
