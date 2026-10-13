import type { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import type { PlanningRepository } from '../infrastructure/planning.repository';
import { AllocateToGoalUseCase } from './allocate-to-goal.use-case';

function goal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'goal-1',
    name: 'Viaje',
    currency: 'DOP',
    accountId: 'acc-1',
    mode: 'EARMARK',
    ...overrides,
  };
}

function setup(options: {
  found?: unknown;
  balance?: number;
  earmarked?: number;
}) {
  const found = 'found' in options ? options.found : goal();
  const repo = {
    findSavingsGoal: jest.fn().mockResolvedValue(found),
    sumEarmarkedByAccount: jest.fn().mockResolvedValue(options.earmarked ?? 0),
    addSavingsGoalContribution: jest.fn().mockResolvedValue({
      id: 'alloc-1',
      goalId: 'goal-1',
      amount: 100,
      contributedAt: new Date('2026-08-01T00:00:00.000Z'),
      kind: 'CONTRIBUTION',
    }),
  };
  const ownership = {
    assertAccountOwned: jest
      .fn()
      .mockResolvedValue({ id: 'acc-1', balance: options.balance ?? 5000 }),
  };
  const useCase = new AllocateToGoalUseCase(
    repo as unknown as PlanningRepository,
    ownership as unknown as FinanceOwnershipService,
  );
  return { repo, useCase };
}

describe('AllocateToGoalUseCase', () => {
  it('sets money aside without creating a movement', async () => {
    const { repo, useCase } = setup({});

    await useCase.execute(
      'user-1',
      'goal-1',
      { amount: 100 },
      new Date('2026-08-02T12:00:00.000Z'),
    );

    expect(repo.addSavingsGoalContribution).toHaveBeenCalledWith(
      'goal-1',
      expect.objectContaining({
        amount: 100,
        kind: 'CONTRIBUTION',
        accountId: 'acc-1',
      }),
      expect.any(Date),
    );
  });

  it('rejects an earmark over the free balance', async () => {
    const { repo, useCase } = setup({ balance: 500, earmarked: 450 });

    await expect(
      useCase.execute('user-1', 'goal-1', { amount: 100 }, new Date()),
    ).rejects.toMatchObject({ response: { code: 'EARMARK_EXCEEDS_BALANCE' } });
    expect(repo.addSavingsGoalContribution).not.toHaveBeenCalled();
  });

  it('allows a withdrawal even with no free balance', async () => {
    const { repo, useCase } = setup({ balance: 100, earmarked: 100 });

    await useCase.execute(
      'user-1',
      'goal-1',
      { amount: 100, kind: 'WITHDRAWAL' },
      new Date(),
    );

    expect(repo.addSavingsGoalContribution).toHaveBeenCalledWith(
      'goal-1',
      expect.objectContaining({ kind: 'WITHDRAWAL' }),
      expect.any(Date),
    );
  });

  it('requires an account when the goal has none', async () => {
    const { useCase } = setup({ found: goal({ accountId: null }) });

    await expect(
      useCase.execute('user-1', 'goal-1', { amount: 100 }, new Date()),
    ).rejects.toMatchObject({ response: { code: 'GOAL_ACCOUNT_REQUIRED' } });
  });

  it('fails when the goal is missing', async () => {
    const { useCase } = setup({ found: null });

    await expect(
      useCase.execute('user-1', 'missing', { amount: 100 }, new Date()),
    ).rejects.toMatchObject({ response: { code: 'GOAL_NOT_FOUND' } });
  });
});
