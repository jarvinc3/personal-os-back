import {
  AI_ACTION_POLICY_VERSION,
  type AiCapabilityDescriptor,
  type AiCapabilityRegistryPort,
} from '@personal-os/contracts';
import { AiActionsRepository } from '../infrastructure/ai-actions.repository';
import { AiActionsService } from './ai-actions.service';
import { AiActionPolicyService } from './ai-action-policy.service';
import { aiActionArgumentDigest } from './ai-action-argument-digest';

type MemoryAction = {
  id: string;
  userId: string;
  actionType: string;
  targetModule: string;
  originReference: string | null;
  payload: Record<string, unknown>;
  policy: 'AUTO_ALLOWED' | 'CONFIRM_REQUIRED' | 'FORBIDDEN';
  policyVersion: string;
  argumentDigest: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  result: Record<string, unknown> | null;
  createdAt: Date;
  executedAt: Date | null;
};

function setup(
  policy: AiCapabilityDescriptor['actionPolicy'] = 'CONFIRM_REQUIRED',
) {
  const rows = new Map<string, MemoryAction>();
  let id = 0;
  const repository = {
    create: jest.fn(async (input: Record<string, unknown>) => {
      await Promise.resolve();
      id += 1;
      const action: MemoryAction = {
        id: `action-${id}`,
        userId: input.userId as string,
        actionType: input.actionType as string,
        targetModule: input.targetModule as string,
        originReference: input.originReference as string,
        payload: input.payload as Record<string, unknown>,
        policy: input.policy as MemoryAction['policy'],
        policyVersion: input.policyVersion as string,
        argumentDigest: input.argumentDigest as string,
        status: (input.status as MemoryAction['status']) ?? 'PENDING',
        result: (input.result as MemoryAction['result']) ?? null,
        createdAt: new Date('2026-11-02T10:00:00Z'),
        executedAt: null,
      };
      rows.set(action.id, action);
      return action;
    }),
    findById: jest.fn(async (actionId: string, userId: string) => {
      await Promise.resolve();
      const action = rows.get(actionId);
      return action?.userId === userId ? action : null;
    }),
    listForUser: jest.fn(async (userId: string) =>
      Promise.resolve(
        [...rows.values()].filter((action) => action.userId === userId),
      ),
    ),
    claimForExecution: jest.fn(async (actionId: string, userId: string) => {
      await Promise.resolve();
      const action = rows.get(actionId);
      if (!action || action.userId !== userId || action.status !== 'PENDING') {
        return null;
      }
      action.status = 'RUNNING';
      action.executedAt = new Date();
      return action;
    }),
    claimForCancel: jest.fn(async (actionId: string, userId: string) => {
      await Promise.resolve();
      const action = rows.get(actionId);
      if (!action || action.userId !== userId || action.status !== 'PENDING') {
        return null;
      }
      action.status = 'CANCELLED';
      action.executedAt = new Date();
      return action;
    }),
    updateStatus: jest.fn(
      async (
        actionId: string,
        userId: string,
        status: MemoryAction['status'],
        result?: Record<string, unknown>,
      ) => {
        await Promise.resolve();
        const action = rows.get(actionId);
        if (
          !action ||
          action.userId !== userId ||
          action.status !== 'RUNNING'
        ) {
          return { count: 0 };
        }
        action.status = status;
        action.result = result ?? null;
        action.executedAt = new Date();
        return { count: 1 };
      },
    ),
  };
  const descriptor: AiCapabilityDescriptor = {
    id: 'finance.update_budget',
    moduleSlug: 'finance',
    version: 1,
    description: 'Actualiza un presupuesto',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    effect: 'WRITE',
    actionPolicy: policy,
  };
  const capabilities: jest.Mocked<AiCapabilityRegistryPort> = {
    register: jest.fn(),
    discover: jest.fn().mockReturnValue([descriptor]),
    validateInput: jest.fn((_capabilityId, args) => args as never),
    execute: jest.fn().mockResolvedValue({ budgetId: 'budget-1' }),
    readContext: jest.fn(),
  };
  const service = new AiActionsService(
    repository as unknown as AiActionsRepository,
    new AiActionPolicyService(),
    capabilities,
  );
  const ctx = {
    userId: 'user-1',
    invocationId: 'invocation-1',
    correlationId: 'conversation-1',
  };
  return { service, repository, capabilities, descriptor, ctx, rows };
}

describe('AiActionsService', () => {
  it('deja una CONFIRM_REQUIRED pendiente sin tocar el proveedor', async () => {
    const { service, capabilities, ctx, repository, descriptor } = setup();
    const proposal = await service.propose(
      ctx,
      descriptor,
      { budgetId: 'budget-1' },
      'conversation-1:call-1',
    );

    expect(proposal).toMatchObject({
      outcome: 'PENDING_CONFIRMATION',
      action: {
        policy: 'CONFIRM_REQUIRED',
        status: 'PENDING',
        argumentDigest: aiActionArgumentDigest({ budgetId: 'budget-1' }),
      },
    });
    expect(repository.create.mock.calls[0]?.[0]).toMatchObject({
      userId: 'user-1',
      policyVersion: AI_ACTION_POLICY_VERSION,
    });
    expect(capabilities.execute.mock.calls).toHaveLength(0);
  });

  it('ejecuta AUTO_ALLOWED pasando por un claim y registra su resultado', async () => {
    const { service, capabilities, ctx, descriptor } = setup('AUTO_ALLOWED');
    const proposal = await service.propose(
      ctx,
      descriptor,
      { budgetId: 'budget-1' },
      'conversation-1:call-1',
    );

    expect(proposal).toMatchObject({
      outcome: 'EXECUTED',
      action: {
        policy: 'AUTO_ALLOWED',
        status: 'SUCCESS',
        result: { ok: true, data: { budgetId: 'budget-1' } },
      },
    });
    expect(capabilities.execute.mock.calls[0]).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        authorization: expect.objectContaining({
          decision: 'AUTO_ALLOWED',
          argumentDigest: aiActionArgumentDigest({ budgetId: 'budget-1' }),
        }),
      }),
      'finance.update_budget',
      { budgetId: 'budget-1' },
    ]);
  });

  it('audita una acción FORBIDDEN y no la ejecuta', async () => {
    const { service, capabilities, ctx, descriptor } = setup('FORBIDDEN');
    const proposal = await service.propose(
      ctx,
      descriptor,
      { budgetId: 'budget-1' },
      'conversation-1:call-1',
    );

    expect(proposal).toMatchObject({
      outcome: 'FORBIDDEN',
      action: {
        policy: 'FORBIDDEN',
        status: 'FAILED',
        result: { ok: false, error: 'ACTION_FORBIDDEN' },
      },
    });
    expect(capabilities.execute.mock.calls).toHaveLength(0);
  });

  it('dos confirmaciones concurrentes producen una sola ejecución; la repetida queda informada', async () => {
    const { service, capabilities, ctx, descriptor } = setup();
    const pending = await service.propose(
      ctx,
      descriptor,
      { budgetId: 'budget-1' },
      'conversation-1:call-1',
    );
    let resolveExecution!: (value: { budgetId: string }) => void;
    capabilities.execute.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExecution = resolve;
        }) as never,
    );

    const first = service.confirm('user-1', pending.action.id);
    await Promise.resolve();
    const second = await service.confirm('user-1', pending.action.id);
    resolveExecution({ budgetId: 'budget-1' });
    const firstResult = await first;
    const third = await service.confirm('user-1', pending.action.id);

    expect(firstResult.outcome).toBe('EXECUTED');
    expect(second.outcome).toBe('ALREADY_CLAIMED');
    expect(third.outcome).toBe('ALREADY_EXECUTED');
    expect(capabilities.execute.mock.calls).toHaveLength(1);
  });

  it('no permite confirmar una acción de otro usuario', async () => {
    const { service, ctx, descriptor } = setup();
    const pending = await service.propose(
      ctx,
      descriptor,
      { budgetId: 'budget-1' },
      'conversation-1:call-1',
    );

    await expect(
      service.confirm('user-2', pending.action.id),
    ).rejects.toMatchObject({ status: 404 });
  });
});
