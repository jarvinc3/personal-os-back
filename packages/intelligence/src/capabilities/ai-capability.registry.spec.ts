import type {
  AiCapabilityDefinition,
  AiCapabilityProvider,
  AiExecutionContext,
  JsonObject,
  JsonValue,
} from '@personal-os/contracts';
import { AI_ACTION_POLICY_VERSION } from '@personal-os/contracts';
import { AiCapabilityError } from '@personal-os/contracts';
import { AiActionsRepository } from '../actions/infrastructure/ai-actions.repository';
import { aiActionArgumentDigest } from '../actions/application/ai-action-argument-digest';
import { AiCapabilityRegistry } from './ai-capability.registry';

const context: AiExecutionContext = {
  userId: 'user-1',
  invocationId: 'invocation-1',
  correlationId: 'correlation-1',
};

function definition(
  moduleSlug: string,
  id = `${moduleSlug}.lookup`,
  overrides: Partial<AiCapabilityDefinition> = {},
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
    ...overrides,
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

function createRegistry(actionClaimed = false) {
  const actions = {
    findClaimedForExecution: jest
      .fn()
      .mockResolvedValue(actionClaimed ? { id: 'action-1' } : null),
  };
  return {
    registry: new AiCapabilityRegistry(
      actions as unknown as AiActionsRepository,
    ),
    actions,
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
    const { registry } = createRegistry();
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
    const { registry } = createRegistry();
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
    const { registry } = createRegistry();
    const { instance, execute } = provider('finance');
    registry.register(instance);
    await expect(
      registry.execute(context, 'finance.lookup', { query: 42 }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_INVALID_ARGUMENTS' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects provider output that does not match its schema contract', async () => {
    const { registry } = createRegistry();
    registry.register(provider('finance', { output: { result: 3 } }).instance);
    await expect(
      registry.execute(context, 'finance.lookup', { query: 'account' }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_INVALID_OUTPUT' });
  });

  it('rejects duplicate capability ids without disturbing existing entries', () => {
    const { registry } = createRegistry();
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
    const { registry } = createRegistry();
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
    const { registry } = createRegistry();
    registry.register(
      provider('finance', { context: { accounts: [] } }).instance,
    );
    await expect(registry.readContext(context, 'finance')).resolves.toEqual({
      accounts: [],
    });
  });

  it('rejects mutating definitions without an explicit policy', () => {
    const { registry } = createRegistry();
    const mutating = definition('finance', 'finance.change', {
      effect: 'WRITE',
    });
    expect(() =>
      registry.register(
        provider('finance', { definitions: [mutating] }).instance,
      ),
    ).toThrow(AiCapabilityError);
  });

  it('blocks every write without a persisted claimed action', async () => {
    const { registry, actions } = createRegistry();
    const execute = jest.fn().mockResolvedValue({ result: 'changed' });
    registry.register({
      moduleSlug: 'finance',
      describe: () => [
        definition('finance', 'finance.change', {
          effect: 'WRITE',
          actionPolicy: 'CONFIRM_REQUIRED',
        }),
      ],
      execute,
    });

    await expect(
      registry.execute(context, 'finance.change', { query: 'value' }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_MUTATION_POLICY_REQUIRED' });
    expect(execute).not.toHaveBeenCalled();
    expect(actions.findClaimedForExecution).not.toHaveBeenCalled();
  });

  it('executes a write only when the action is claimed and args match its digest', async () => {
    const { registry, actions } = createRegistry(true);
    const execute = jest.fn().mockResolvedValue({ result: 'changed' });
    registry.register({
      moduleSlug: 'finance',
      describe: () => [
        definition('finance', 'finance.change', {
          effect: 'WRITE',
          actionPolicy: 'CONFIRM_REQUIRED',
        }),
      ],
      execute,
    });
    const writeContext: AiExecutionContext = {
      ...context,
      authorization: {
        actionId: 'action-1',
        capabilityId: 'finance.change',
        argumentDigest: aiActionArgumentDigest({ query: 'value' }),
        policyVersion: AI_ACTION_POLICY_VERSION,
        decision: 'CONFIRM_REQUIRED',
      },
    };

    await expect(
      registry.execute(writeContext, 'finance.change', { query: 'value' }),
    ).resolves.toEqual({ result: 'changed' });
    expect(actions.findClaimedForExecution).toHaveBeenCalledWith({
      id: 'action-1',
      userId: context.userId,
      actionType: 'finance.change',
      policy: 'CONFIRM_REQUIRED',
      policyVersion: AI_ACTION_POLICY_VERSION,
      argumentDigest: aiActionArgumentDigest({ query: 'value' }),
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
