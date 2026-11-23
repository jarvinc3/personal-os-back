import type { CreateTransferUseCase } from '../../ledger/application/create-transfer.use-case';
import type { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { localDateIso } from '../../shared/domain/local-day';
import type { PlanningRepository } from '../infrastructure/planning.repository';
import { AllocateToGoalUseCase } from './allocate-to-goal.use-case';

function goal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'goal-1',
    name: 'Viaje',
    currency: 'DOP',
    accountId: 'acc-1',
    currentAmount: '1000',
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
    findUserTimezone: jest.fn().mockResolvedValue('America/Santo_Domingo'),
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
      .mockImplementation((_userId: string, accountId: string) =>
        Promise.resolve({
          id: accountId,
          balance: options.balance ?? 5000,
          currency: 'DOP',
          isActive: true,
        }),
      ),
  };
  const createTransfer = {
    execute: jest.fn().mockResolvedValue({
      transferGroupId: 'group-1',
      debit: { id: 'debit-1' },
      credit: { id: 'credit-1' },
    }),
  };
  const useCase = new AllocateToGoalUseCase(
    repo as unknown as PlanningRepository,
    ownership as unknown as FinanceOwnershipService,
    createTransfer as unknown as CreateTransferUseCase,
  );
  return { repo, useCase, createTransfer };
}

describe('AllocateToGoalUseCase', () => {
  it('sets money aside without creating a movement', async () => {
    const { repo, useCase } = setup({});

    await useCase.execute({
      userId: 'user-1',
      goalId: 'goal-1',
      dto: { amount: 100 },
      now: new Date('2026-08-02T12:00:00.000Z'),
    });

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

  it('registers the contribution on the local day the user picked', async () => {
    const { repo, useCase, createTransfer } = setup({});

    // 2026-10-23 20:00 in Santo Domingo, the case the QA reported.
    await useCase.execute({
      userId: 'user-1',
      goalId: 'goal-1',
      dto: { amount: 100, date: '2026-10-23', fromAccountId: 'acc-2' },
      now: new Date('2026-10-24T00:00:00.000Z'),
    });

    expect(createTransfer.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        transactionDate: '2026-10-24T00:00:00.000Z',
        announce: false,
      }),
    );
    const allocation = repo.addSavingsGoalContribution.mock.calls[0][1];
    expect((allocation.contributedAt as Date).toISOString()).toBe(
      '2026-10-24T00:00:00.000Z',
    );
    expect(
      localDateIso('America/Santo_Domingo', allocation.contributedAt as Date),
    ).toBe('2026-10-23');
  });

  it('keeps the server time when no date is sent', async () => {
    const { repo, useCase } = setup({});
    const now = new Date('2026-10-24T00:00:00.000Z');

    await useCase.execute({
      userId: 'user-1',
      goalId: 'goal-1',
      dto: { amount: 100 },
      now: now,
    });

    const allocation = repo.addSavingsGoalContribution.mock.calls[0][1];
    expect(allocation.contributedAt).toBe(now);
  });

  it('rejects an earmark over the free balance', async () => {
    const { repo, useCase } = setup({ balance: 500, earmarked: 450 });

    await expect(
      useCase.execute({
        userId: 'user-1',
        goalId: 'goal-1',
        dto: { amount: 100 },
        now: new Date(),
      }),
    ).rejects.toMatchObject({ response: { code: 'EARMARK_EXCEEDS_BALANCE' } });
    expect(repo.addSavingsGoalContribution).not.toHaveBeenCalled();
  });

  it('allows a withdrawal even with no free balance', async () => {
    const { repo, useCase } = setup({ balance: 100, earmarked: 100 });

    await useCase.execute({
      userId: 'user-1',
      goalId: 'goal-1',
      dto: { amount: 100, kind: 'WITHDRAWAL', toAccountId: 'acc-2' },
      now: new Date(),
    });

    expect(repo.addSavingsGoalContribution).toHaveBeenCalledWith(
      'goal-1',
      expect.objectContaining({
        kind: 'WITHDRAWAL',
        destinationAccountId: 'acc-2',
      }),
      expect.any(Date),
    );
  });

  it('rejects a withdrawal without a destination account', async () => {
    const { repo, useCase } = setup({});

    await expect(
      useCase.execute({
        userId: 'user-1',
        goalId: 'goal-1',
        dto: { amount: 100, kind: 'WITHDRAWAL' },
        now: new Date(),
      }),
    ).rejects.toMatchObject({
      response: { code: 'GOAL_WITHDRAWAL_ACCOUNT_REQUIRED' },
    });
    expect(repo.addSavingsGoalContribution).not.toHaveBeenCalled();
  });

  it('rejects a withdrawal over the available amount', async () => {
    const { repo, useCase } = setup({
      found: goal({ currentAmount: '50' }),
    });

    await expect(
      useCase.execute({
        userId: 'user-1',
        goalId: 'goal-1',
        dto: { amount: 100, kind: 'WITHDRAWAL', toAccountId: 'acc-2' },
        now: new Date(),
      }),
    ).rejects.toMatchObject({
      response: { code: 'GOAL_WITHDRAWAL_EXCEEDS_AVAILABLE', max: 50 },
    });
    expect(repo.addSavingsGoalContribution).not.toHaveBeenCalled();
  });

  it('moves a withdrawal to another account and links only the group', async () => {
    const { repo, useCase, createTransfer } = setup({});

    await useCase.execute({
      userId: 'user-1',
      goalId: 'goal-1',
      dto: { amount: 100, kind: 'WITHDRAWAL', toAccountId: 'acc-2' },
      now: new Date('2026-08-02T12:00:00.000Z'),
    });

    expect(createTransfer.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        fromAccountId: 'acc-1',
        toAccountId: 'acc-2',
        amount: 100,
        currency: 'DOP',
        announce: false,
      }),
    );
    expect(repo.addSavingsGoalContribution).toHaveBeenCalledWith(
      'goal-1',
      expect.objectContaining({
        kind: 'WITHDRAWAL',
        destinationAccountId: 'acc-2',
        transferGroupId: 'group-1',
      }),
      expect.any(Date),
    );
    const allocation = repo.addSavingsGoalContribution.mock.calls[0][1];
    expect(allocation.transactionId).toBeUndefined();
  });

  it('requires an account when the goal has none', async () => {
    const { useCase } = setup({ found: goal({ accountId: null }) });

    await expect(
      useCase.execute({
        userId: 'user-1',
        goalId: 'goal-1',
        dto: { amount: 100 },
        now: new Date(),
      }),
    ).rejects.toMatchObject({ response: { code: 'GOAL_ACCOUNT_REQUIRED' } });
  });

  it('fails when the goal is missing', async () => {
    const { useCase } = setup({ found: null });

    await expect(
      useCase.execute({
        userId: 'user-1',
        goalId: 'missing',
        dto: { amount: 100 },
        now: new Date(),
      }),
    ).rejects.toMatchObject({ response: { code: 'GOAL_NOT_FOUND' } });
  });

  it('moves the money and links the movement when the source account differs', async () => {
    const { repo, useCase, createTransfer } = setup({});

    await useCase.execute({
      userId: 'user-1',
      goalId: 'goal-1',
      dto: { amount: 100, fromAccountId: 'acc-2' },
      now: new Date('2026-08-02T12:00:00.000Z'),
    });

    expect(createTransfer.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        fromAccountId: 'acc-2',
        toAccountId: 'acc-1',
        amount: 100,
        currency: 'DOP',
      }),
    );
    expect(repo.addSavingsGoalContribution).toHaveBeenCalledWith(
      'goal-1',
      expect.objectContaining({
        transferGroupId: 'group-1',
        transactionId: 'credit-1',
      }),
      expect.any(Date),
    );
  });

  it('keeps the transfer out when the source account is the goal account', async () => {
    const { useCase, createTransfer } = setup({});

    await useCase.execute({
      userId: 'user-1',
      goalId: 'goal-1',
      dto: { amount: 100, fromAccountId: 'acc-1' },
      now: new Date(),
    });

    expect(createTransfer.execute).not.toHaveBeenCalled();
  });

  it('rejects the transfer when the source account has no free balance', async () => {
    const { repo, useCase, createTransfer } = setup({
      balance: 500,
      earmarked: 450,
    });

    await expect(
      useCase.execute({
        userId: 'user-1',
        goalId: 'goal-1',
        dto: { amount: 100, fromAccountId: 'acc-2' },
        now: new Date(),
      }),
    ).rejects.toMatchObject({ response: { code: 'EARMARK_EXCEEDS_BALANCE' } });
    expect(createTransfer.execute).not.toHaveBeenCalled();
    expect(repo.addSavingsGoalContribution).not.toHaveBeenCalled();
  });
});
