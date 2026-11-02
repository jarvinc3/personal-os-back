import { AiActionsRepository } from './ai-actions.repository';

describe('AiActionsRepository', () => {
  it('claims only a PENDING action owned by the confirming user', async () => {
    const claimed = { id: 'action-1', userId: 'user-1', status: 'RUNNING' };
    const prisma = {
      aiAction: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(claimed),
      },
    };
    const repository = new AiActionsRepository(prisma as never);

    await expect(
      repository.claimForExecution('action-1', 'user-1'),
    ).resolves.toEqual(claimed);
    expect(prisma.aiAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'action-1', status: 'PENDING', userId: 'user-1' },
      data: { status: 'RUNNING', executedAt: expect.any(Date) },
    });
    expect(prisma.aiAction.findFirst).toHaveBeenCalledWith({
      where: { id: 'action-1', userId: 'user-1' },
    });
  });

  it('does not load or execute an action when another request already claimed it', async () => {
    const prisma = {
      aiAction: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn(),
      },
    };
    const repository = new AiActionsRepository(prisma as never);

    await expect(
      repository.claimForExecution('action-1', 'user-1'),
    ).resolves.toBeNull();
    expect(prisma.aiAction.findFirst).not.toHaveBeenCalled();
  });

  it('only updates a claimed RUNNING action and records terminal execution time', async () => {
    const prisma = {
      aiAction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const repository = new AiActionsRepository(prisma as never);

    await repository.updateStatus('action-1', 'user-1', 'SUCCESS', {
      ok: true,
    });
    expect(prisma.aiAction.updateMany).toHaveBeenCalledWith({
      where: { id: 'action-1', userId: 'user-1', status: 'RUNNING' },
      data: {
        status: 'SUCCESS',
        result: { ok: true },
        executedAt: expect.any(Date),
      },
    });
  });

  it('fails stale claims with a typed, sanitized timeout result', async () => {
    const prisma = {
      aiAction: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const repository = new AiActionsRepository(prisma as never);
    const cutoff = new Date('2026-11-02T10:00:00Z');

    await expect(repository.failStaleRunning(cutoff)).resolves.toBe(2);
    expect(prisma.aiAction.updateMany).toHaveBeenCalledWith({
      where: { status: 'RUNNING', executedAt: { lt: cutoff } },
      data: {
        status: 'FAILED',
        result: { ok: false, error: 'ACTION_TIMEOUT' },
        executedAt: expect.any(Date),
      },
    });
  });
});
