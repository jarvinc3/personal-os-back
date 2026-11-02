import type {
  AiCapabilityDefinition,
  AiCapabilityProvider,
  AiExecutionContext,
  JsonObject,
  JsonValue,
} from '@personal-os/contracts';
import { AiCapabilityError } from '@personal-os/contracts';
import { AiCapabilityRegistry } from './ai-capability.registry';

const context: AiExecutionContext = {
  userId: 'user-1',
  invocationId: 'invocation-1',
  correlationId: 'correlation-1',
};

function definition(
  moduleSlug: string,
  id = `${moduleSlug}.lookup`,
): AiCapabilityDefinition {
  return {
    id,
    moduleSlug,
    version: 1,
    description: `Look up ${moduleSlug} information`,
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: { result: { type: 'string' } },
    },
    effect: 'READ',
    validateInput(value: unknown): JsonObject {
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        typeof (value as Record<string, unknown>).query !== 'string'
      ) {
        throw new Error('query must be a string');
      }
      return value as JsonObject;
    },
    validateOutput(value: unknown): JsonValue {
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        typeof (value as Record<string, unknown>).result !== 'string'
      ) {
        throw new Error('result must be a string');
      }
      return value as JsonObject;
    },
  };
}

function provider(
  moduleSlug: string,
  options: {
    available?: boolean;
    output?: unknown;
    definitions?: AiCapabilityDefinition[];
    context?: JsonObject;
  } = {},
) {
  const execute = jest
    .fn()
    .mockResolvedValue(options.output ?? { result: 'ok' });
  const instance: AiCapabilityProvider = {
    moduleSlug,
    describe: () => options.definitions ?? [definition(moduleSlug)],
    isAvailable: jest.fn(() => options.available ?? true),
    execute,
    readContext: jest.fn(() =>
      Promise.resolve(options.context ?? { moduleSlug }),
    ),
  };
  return { instance, execute };
}

describe('AiCapabilityRegistry', () => {
  it('discovers module capabilities with descriptions and schemas', () => {
    const registry = new AiCapabilityRegistry();
    registry.register(provider('finance').instance);
    const [capability] = registry.discover();
    expect(capability).toMatchObject({
      id: 'finance.lookup',
      moduleSlug: 'finance',
      description: 'Look up finance information',
      inputSchema: expect.objectContaining({ required: ['query'] }),
      outputSchema: expect.any(Object),
    });
    expect(capability).not.toHaveProperty('validateInput');
  });

  it('executes a registered capability using validated arguments', async () => {
    const registry = new AiCapabilityRegistry();
    const { instance, execute } = provider('finance');
    registry.register(instance);
    await expect(
      registry.execute(context, 'finance.lookup', { query: 'account' }),
    ).resolves.toEqual({ result: 'ok' });
    expect(execute).toHaveBeenCalledWith(context, 'finance.lookup', {
      query: 'account',
    });
  });

  it('rejects invalid arguments before the module provider runs', async () => {
    const registry = new AiCapabilityRegistry();
    const { instance, execute } = provider('finance');
    registry.register(instance);
    await expect(
      registry.execute(context, 'finance.lookup', { query: 42 }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_INVALID_ARGUMENTS' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects provider output that does not match its schema contract', async () => {
    const registry = new AiCapabilityRegistry();
    registry.register(provider('finance', { output: { result: 3 } }).instance);
    await expect(
      registry.execute(context, 'finance.lookup', { query: 'account' }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_INVALID_OUTPUT' });
  });

  it('rejects duplicate capability ids without disturbing existing entries', () => {
    const registry = new AiCapabilityRegistry();
    registry.register(
      provider('finance', {
        definitions: [definition('finance', 'shared.lookup')],
      }).instance,
    );
    expect(() =>
      registry.register(
        provider('users', {
          definitions: [definition('users', 'shared.lookup')],
        }).instance,
      ),
    ).toThrow(AiCapabilityError);
    expect(registry.discover()).toHaveLength(1);
  });

  it('returns a typed unavailable error while keeping other modules usable', async () => {
    const registry = new AiCapabilityRegistry();
    registry.register(provider('offline', { available: false }).instance);
    registry.register(provider('users').instance);
    await expect(
      registry.execute(context, 'offline.lookup', { query: 'x' }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    await expect(
      registry.execute(context, 'users.lookup', { query: 'x' }),
    ).resolves.toEqual({ result: 'ok' });
  });

  it('delegates context lookup to the owning module provider', async () => {
    const registry = new AiCapabilityRegistry();
    registry.register(
      provider('finance', { context: { accounts: [] } }).instance,
    );
    await expect(registry.readContext(context, 'finance')).resolves.toEqual({
      accounts: [],
    });
  });
});
