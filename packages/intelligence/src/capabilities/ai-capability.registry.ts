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
import {
  errorMessage,
  isJsonObject,
  isJsonValue,
  readProviderDefinitions,
  toCapabilityDescriptor,
} from './ai-capability-definition';

type RegisteredCapability = {
  provider: AiCapabilityProvider;
  definition: AiCapabilityDefinition;
};

type MutationAuthorization = {
  registered: RegisteredCapability;
  ctx: AiExecutionContext;
  validatedArgs: JsonObject;
};

@Injectable()
export class AiCapabilityRegistry implements AiCapabilityRegistryPort {
  private readonly capabilities = new Map<string, RegisteredCapability>();
  private readonly providers = new Map<string, AiCapabilityProvider[]>();
  private readonly registeredInstances = new WeakSet<AiCapabilityProvider>();

  constructor(private readonly actions: AiActionsRepository) {}

  register(provider: AiCapabilityProvider): void {
    this.assertProviderRegistrable(provider);
    const definitions = readProviderDefinitions(provider);
    this.assertCapabilitiesAvailable(definitions);

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
      .map(({ definition }) => toCapabilityDescriptor(definition))
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
      await this.assertMutationAuthorized({
        registered,
        ctx,
        validatedArgs,
      });
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

  async resolveEntity(
    ctx: AiExecutionContext,
    ref: { type: string; id: string },
  ): Promise<JsonValue | null> {
    for (const provider of this.providers.values()) {
      for (const candidate of provider) {
        if (
          !candidate.resolveEntity ||
          !(await this.isAvailable(candidate, ctx))
        ) {
          continue;
        }
        const resolved = await candidate.resolveEntity(ctx, ref);
        if (resolved !== null) {
          return resolved;
        }
      }
    }
    return null;
  }

  private assertProviderRegistrable(provider: AiCapabilityProvider): void {
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
  }

  private assertCapabilitiesAvailable(
    definitions: readonly AiCapabilityDefinition[],
  ): void {
    const pending = new Set<string>();
    for (const definition of definitions) {
      if (this.capabilities.has(definition.id) || pending.has(definition.id)) {
        throw new AiCapabilityError(
          'CAPABILITY_CONFLICT',
          `Capability ${definition.id} is already registered`,
          { capabilityId: definition.id, moduleSlug: definition.moduleSlug },
        );
      }
      pending.add(definition.id);
    }
  }

  private async assertMutationAuthorized({
    registered,
    ctx,
    validatedArgs,
  }: MutationAuthorization): Promise<void> {
    const authorization = ctx.authorization;
    if (
      !authorization ||
      !this.hasValidAuthorization(
        authorization,
        registered.definition,
        validatedArgs,
      )
    ) {
      throw new AiCapabilityError(
        'CAPABILITY_MUTATION_POLICY_REQUIRED',
        `Capability ${registered.definition.id} requires an authorized AI action`,
        { capabilityId: registered.definition.id },
      );
    }
    const claimed = await this.actions.findClaimedForExecution({
      id: authorization.actionId,
      userId: ctx.userId,
      actionType: registered.definition.id,
      policy: authorization.decision,
      policyVersion: authorization.policyVersion,
      argumentDigest: authorization.argumentDigest,
    });
    if (!claimed) {
      throw new AiCapabilityError(
        'CAPABILITY_MUTATION_POLICY_REQUIRED',
        `Capability ${registered.definition.id} requires a claimed AI action`,
        { capabilityId: registered.definition.id },
      );
    }
  }

  private hasValidAuthorization(
    authorization: NonNullable<AiExecutionContext['authorization']>,
    definition: AiCapabilityDefinition,
    validatedArgs: JsonObject,
  ): boolean {
    return (
      Boolean(authorization.actionId) &&
      Boolean(authorization.argumentDigest) &&
      authorization.capabilityId === definition.id &&
      authorization.policyVersion === AI_ACTION_POLICY_VERSION &&
      authorization.decision === definition.actionPolicy &&
      authorization.argumentDigest === aiActionArgumentDigest(validatedArgs)
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
