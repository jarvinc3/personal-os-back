import {
  AiCapabilityError,
  type AiCapabilityDefinition,
  type AiCapabilityDescriptor,
  type AiCapabilityProvider,
  type JsonObject,
  type JsonValue,
} from '@personal-os/contracts';

const WRITE_ACTION_POLICIES = [
  'AUTO_ALLOWED',
  'CONFIRM_REQUIRED',
  'FORBIDDEN',
] as const;

export function isJsonValue(value: unknown): value is JsonValue {
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

export function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    isJsonValue(value)
  );
}

/**
 * A provider is plain JavaScript at the edge, so its definitions are checked
 * field by field before the registry keeps them.
 */
export function isCapabilityDefinition(
  value: unknown,
  moduleSlug: string,
): value is AiCapabilityDefinition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<AiCapabilityDefinition>;
  return (
    hasValidIdentity(candidate, moduleSlug) &&
    hasValidSchemas(candidate) &&
    hasValidEffect(candidate) &&
    hasValidValidators(candidate)
  );
}

function hasValidIdentity(
  candidate: Partial<AiCapabilityDefinition>,
  moduleSlug: string,
): boolean {
  return (
    typeof candidate.id === 'string' &&
    candidate.id.trim() !== '' &&
    candidate.moduleSlug === moduleSlug &&
    Number.isInteger(candidate.version) &&
    (candidate.version ?? 0) >= 1 &&
    typeof candidate.description === 'string' &&
    candidate.description.trim() !== ''
  );
}

function hasValidSchemas(candidate: Partial<AiCapabilityDefinition>): boolean {
  return (
    isJsonObject(candidate.inputSchema) && isJsonObject(candidate.outputSchema)
  );
}

function hasValidEffect(candidate: Partial<AiCapabilityDefinition>): boolean {
  if (candidate.effect !== 'READ' && candidate.effect !== 'WRITE') {
    return false;
  }
  if (candidate.effect === 'READ') {
    return candidate.actionPolicy === undefined;
  }
  return (
    candidate.actionPolicy !== undefined &&
    WRITE_ACTION_POLICIES.includes(candidate.actionPolicy)
  );
}

function hasValidValidators(
  candidate: Partial<AiCapabilityDefinition>,
): boolean {
  return (
    typeof candidate.validateInput === 'function' &&
    typeof candidate.validateOutput === 'function'
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Capability provider failed';
}

export function toCapabilityDescriptor(
  definition: AiCapabilityDefinition,
): AiCapabilityDescriptor {
  return {
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
  };
}

/** Reads what a provider describes and validates every definition once. */
export function readProviderDefinitions(
  provider: AiCapabilityProvider,
): readonly AiCapabilityDefinition[] {
  let described: unknown;
  try {
    described = provider.describe();
  } catch (error) {
    throw new AiCapabilityError(
      'CAPABILITY_INVALID_DEFINITION',
      `Could not describe capabilities for ${provider.moduleSlug}: ${errorMessage(error)}`,
      { moduleSlug: provider.moduleSlug },
    );
  }
  if (!Array.isArray(described)) {
    throw new AiCapabilityError(
      'CAPABILITY_INVALID_DEFINITION',
      `Capability provider ${provider.moduleSlug} must return an array of definitions`,
      { moduleSlug: provider.moduleSlug },
    );
  }
  const definitions: readonly unknown[] = described;
  return definitions.map((definition) => {
    if (!isCapabilityDefinition(definition, provider.moduleSlug)) {
      throw new AiCapabilityError(
        'CAPABILITY_INVALID_DEFINITION',
        `Invalid capability definition from ${provider.moduleSlug}`,
        {
          moduleSlug: provider.moduleSlug,
          capabilityId: readCapabilityId(definition),
        },
      );
    }
    return definition;
  });
}

function cloneSchema(schema: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(schema)) as JsonObject;
}

function readCapabilityId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const capabilityId = (value as { id?: unknown }).id;
  return typeof capabilityId === 'string' ? capabilityId : undefined;
}
